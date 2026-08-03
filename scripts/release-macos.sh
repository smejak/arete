#!/usr/bin/env bash
#
# Build a signed, notarized Arete release for macOS.
#
# The committed Tauri config ad-hoc signs, so anyone can `npm run tauri:build`
# without a certificate. This script is the other path: it overrides the
# identity with the Developer ID one and hands Tauri notarization credentials,
# which together are what let a downloaded Arete open without a Gatekeeper
# block.
#
# It refuses to be optimistic. The build having "succeeded" says nothing about
# whether a stranger can open the result — Tauri warns and carries on when
# notarization credentials are missing, and a warning in the middle of a long
# log is exactly the thing that shipped a broken v0.0.6. So the artifact is
# interrogated afterwards, and anything short of "accepted, notarized" fails.
#
# Run this from your own shell. Credentials come from the environment and
# nothing secret is read from or written to the repo, which only holds if the
# environment they live in is yours. Either set:
#
#   APPLE_ID             the account email
#   APPLE_PASSWORD       an app-specific password from appleid.apple.com,
#                        never the account password
#   APPLE_TEAM_ID        KHQ5SR2NFL
#
# or, if you have App Store Connect API access — team key generation is rolled
# out to organization accounts ahead of individual ones, so this may not be
# available yet:
#
#   APPLE_API_KEY        key id
#   APPLE_API_ISSUER     issuer id (a uuid)
#   APPLE_API_KEY_PATH   path to the AuthKey_XXX.p8, kept outside the repo
#
set -euo pipefail

cd "$(dirname "$0")/.."

die() { printf '\n\033[31merror:\033[0m %s\n' "$1" >&2; exit 1; }
step() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }

# rustup's toolchain must win over Homebrew's older rustc, which is too old for
# the dependency tree and shadows it on a default PATH.
export PATH="$HOME/.cargo/bin:$PATH"

step "Checking the signing identity"

# Explicit override wins; otherwise take the Developer ID from the keychain.
IDENTITY="${APPLE_SIGNING_IDENTITY:-}"
if [ -z "$IDENTITY" ]; then
  IDENTITY=$(security find-identity -v -p codesigning \
    | grep "Developer ID Application" \
    | head -1 \
    | sed -E 's/.*"(.*)"$/\1/') || true
fi
[ -n "$IDENTITY" ] || die "no 'Developer ID Application' certificate in the keychain.
  Create one in Xcode → Settings → Accounts → Manage Certificates → + ,
  then check it appears in: security find-identity -v -p codesigning
  (An 'Apple Development' certificate will not do — Apple does not accept it
  for distribution outside the App Store.)"
echo "  $IDENTITY"
export APPLE_SIGNING_IDENTITY="$IDENTITY"

step "Checking notarization credentials"
if [ -n "${APPLE_API_KEY:-}" ] && [ -n "${APPLE_API_ISSUER:-}" ] && [ -n "${APPLE_API_KEY_PATH:-}" ]; then
  [ -f "$APPLE_API_KEY_PATH" ] || die "APPLE_API_KEY_PATH points at nothing: $APPLE_API_KEY_PATH"
  echo "  App Store Connect API key ${APPLE_API_KEY}"
  NOTARY_AUTH=(--key "$APPLE_API_KEY_PATH" --key-id "$APPLE_API_KEY" --issuer "$APPLE_API_ISSUER")
  AUTH_SHOWN='--key "$APPLE_API_KEY_PATH" --key-id "$APPLE_API_KEY" --issuer "$APPLE_API_ISSUER"'
elif [ -n "${APPLE_ID:-}" ] && [ -n "${APPLE_PASSWORD:-}" ] && [ -n "${APPLE_TEAM_ID:-}" ]; then
  echo "  Apple ID ${APPLE_ID} (team ${APPLE_TEAM_ID})"
  NOTARY_AUTH=(--apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID")
  AUTH_SHOWN='--apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID"'
else
  die "no notarization credentials in the environment.
  Set APPLE_ID + APPLE_PASSWORD + APPLE_TEAM_ID,
  or APPLE_API_KEY + APPLE_API_ISSUER + APPLE_API_KEY_PATH.
  Without them Tauri only warns, and ships an app that cannot be opened."
fi

# Ask Apple whether the credentials work before compiling for two minutes on
# the strength of them. Tauri reports a notarization failure as an empty error
# — "failed to notarize app:" and nothing after the colon — so a mistyped
# password is otherwise indistinguishable from anything else going wrong, and
# only says so at the very end.
if ! CHECK=$(xcrun notarytool history "${NOTARY_AUTH[@]}" 2>&1); then
  die "Apple rejected these credentials:

$(printf '%s\n' "$CHECK" | sed 's/^/    /')

  Most often one of:
    - APPLE_PASSWORD is the account password, not an app-specific one
      (appleid.apple.com → Sign-In and Security → App-Specific Passwords)
    - the app-specific password was made under a different Apple ID than
      APPLE_ID — they have to be the same account
    - APPLE_ID is not a member of team ${APPLE_TEAM_ID:-named above}
    - a Program License Agreement is waiting to be accepted at
      developer.apple.com/account"
fi
echo "  accepted by Apple"

step "Building (this notarizes, so it waits on Apple — several minutes)"

# Tauri reports a notarization failure as an empty error — "failed to notarize
# app:" and nothing after the colon — and takes the submission id down with it,
# scrolled off the top of a long build log. That is what made the v0.0.6
# failure undiagnosable: Apple had an opinion and there was no way left to ask
# for it. So keep the whole build output, and on failure say which submission
# to go and ask about.
BUILD_LOG="${TMPDIR:-/tmp}/arete-build-$(date +%Y%m%d-%H%M%S).log"
if ! npm run tauri:build 2>&1 | tee "$BUILD_LOG"; then
  HINT=""
  SUB=$(grep -Eoi '[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}' "$BUILD_LOG" | tail -1 || true)
  # $AUTH_SHOWN is deliberately the unexpanded variable names: this gets
  # printed, and a password on screen is a password in the scrollback.
  [ -n "$SUB" ] && HINT="
  It got as far as submitting to Apple, so there is a verdict to collect.
  It outlives the build — 'Accepted' means only the waiting broke:

    xcrun notarytool log $SUB $AUTH_SHOWN
    xcrun notarytool wait $SUB $AUTH_SHOWN
"
  die "the build failed. Full output:

    $BUILD_LOG
$HINT"
fi

VERSION=$(python3 -c "import json;print(json.load(open('src-tauri/tauri.conf.json'))['version'])")
DMG="src-tauri/target/release/bundle/dmg/Arete_${VERSION}_aarch64.dmg"
[ -f "$DMG" ] || die "expected a dmg at $DMG and there is none"

step "Notarizing the dmg (Tauri only notarized the app inside it)"

# Tauri notarizes the .app and staples a ticket into it, then wraps it in a
# disk image that has been through none of that. The dmg is the file that is
# downloaded, so the dmg is the file that gets a quarantine attribute and is
# assessed by Gatekeeper when it is double-clicked — and an unnotarized
# container meets exactly the "Apple could not verify…" block the app inside
# it no longer does. Notarizing the app is not notarizing the download.
#
# Submitting the container again is cheap: Apple has already seen this code,
# and the app inside keeps the ticket it was stapled at build time, so the
# result is notarized at both levels.
if ! SUBMIT=$(xcrun notarytool submit "$DMG" --wait "${NOTARY_AUTH[@]}" 2>&1); then
  printf '%s\n' "$SUBMIT" | sed 's/^/  /'
  SUB=$(printf '%s' "$SUBMIT" | grep -Eoi '[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}' | head -1 || true)
  die "Apple did not accept the dmg.${SUB:+

  What it objected to:

    xcrun notarytool log $SUB $AUTH_SHOWN}"
fi
printf '%s\n' "$SUBMIT" | sed 's/^/  /'

# Staple so the ticket travels with the file. Without this the check happens
# online, and a first launch with no network is a first launch that fails.
xcrun stapler staple "$DMG" >/dev/null \
  || die "the dmg was accepted but the ticket would not staple to it"
echo "  ticket stapled"

step "Verifying the app inside the dmg"

# Check what actually ships, not the build directory beside it: the dmg is the
# only thing anyone downloads.
MNT=$(mktemp -d /tmp/arete-verify.XXXXXX)
hdiutil attach -nobrowse -readonly "$DMG" -mountpoint "$MNT" >/dev/null
trap 'hdiutil detach "$MNT" -quiet 2>/dev/null || true; rm -rf "$MNT"' EXIT
APP="$MNT/Arete.app"

codesign --verify --deep --strict --verbose=2 "$APP" 2>&1 | sed 's/^/  /'

# Captured into a variable rather than piped into `grep -q`. grep exits the
# moment it matches, codesign is still writing, and the SIGPIPE that follows
# is a non-zero exit that `set -o pipefail` promotes to a failed pipeline —
# so the pipeline reports 141 on the runs where the match is found early.
# That is a check which fails precisely when it should pass, and it rejected
# a correctly signed v0.0.7. Matching in the shell has no pipe to break.
INFO=$(codesign -dv --verbose=2 "$APP" 2>&1)
case "$INFO" in
  *"Authority=Developer ID Application"*) ;;
  *) die "the app is not signed with a Developer ID certificate" ;;
esac

xcrun stapler validate "$APP" >/dev/null 2>&1 \
  || die "no notarization ticket is stapled to the app.
  It will still show 'Apple could not verify…' on a downloaded copy."

# The verdict that matters: what Gatekeeper says about a copy that arrived from
# the internet, which is the only situation any of this affects.
#
# `|| true` because spctl exits non-zero exactly when it rejects, and under
# `set -e` an assignment from a failing substitution ends the script there —
# taking the explanation below with it. The failure has to survive long enough
# to be reported.
ASSESS=$(spctl -a -vvv -t exec "$APP" 2>&1) || true
printf '%s\n' "$ASSESS" | sed 's/^/  /'
case "$ASSESS" in
  *accepted*) ;;
  *) die "Gatekeeper rejects the app; it would be blocked on another Mac" ;;
esac
case "$ASSESS" in
  *"source=Notarized Developer ID"*) ;;
  *) die "accepted, but not as a notarized Developer ID app" ;;
esac

# And now the container, assessed the way macOS will assess it when someone
# double-clicks the thing they downloaded. `-t open` asks about the disk
# image itself rather than the app within, which is the question that was
# never being asked: v0.0.7 first passed every check above while its dmg was
# still `source=Unnotarized Developer ID`, and would have shipped with the
# warning intact and a README promising otherwise.
DMG_VERDICT=$(spctl -a -vvv -t open --context context:primary-signature "$DMG" 2>&1) || true
printf '%s\n' "$DMG_VERDICT" | sed 's/^/  /'
case "$DMG_VERDICT" in
  *"source=Notarized Developer ID"*) ;;
  *) die "the dmg itself is not notarized — opening the download would still
  be blocked, whatever the app inside it says" ;;
esac

OUT="../arete-releases/Arete-v${VERSION}.dmg"
cp "$DMG" "$OUT"

step "Done"
cat <<EOF

  Signed, notarized, stapled, and accepted by Gatekeeper.

  Upload to the v${VERSION} release, under exactly this name:

    $(cd "$(dirname "$OUT")" && pwd)/$(basename "$OUT")

  sha256  $(shasum -a 256 "$OUT" | cut -d' ' -f1)

EOF
