#!/bin/bash
# Puts the release built by build-release.sh (/Users/Shared/LumaPOS/app-next)
# in place of the live one and restarts web, sync and notifications; restores
# the previous release if the web server does not come up.
#
#   sudo bash ops/macos/deploy-release.sh
#
# The steps live in lumapos-admin. When the helper is installed
# (install-admin-helper.sh) prefer `sudo /usr/local/libexec/lumapos-admin deploy`,
# which needs no password for the store Mac's user.
set -euo pipefail
exec /bin/bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lumapos-admin" deploy
