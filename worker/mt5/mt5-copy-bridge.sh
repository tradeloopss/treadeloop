#!/bin/bash
# Runs one MT5 bridge (bridge.py) for a copy-lane terminal slot $1 (c1, c2, ...)
# on port 9110+N. Installed on the sync server as /usr/local/bin/mt5-copy-bridge
# and started by mt5-copy-bridge@<slot>.service. These terminals belong to
# tradeloop-copy-lane: each stays logged in to one copying account.
#
# Each slot gets a Wine desktop of its own (explorer /desktop=...), so nothing
# that happens to another terminal's windows reaches it: the bridge finds its
# own terminal's window and no other, and the "Algo Trading" key press it sends
# stays inside. pythonw, not python: a console window on that desktop is
# closed by Wine after a few seconds, and takes the bridge with it.
slot="$1"; port=$((9110 + ${slot#c}))
token="$(cat /srv/mt5/bridge.token)"
/opt/wine-stable/bin/wine explorer "/desktop=tl-$slot,1280x800" "C:/Program Files/Python311/pythonw.exe" -u C:/mt5/bridge.py \
  --terminal "C:/mt5/$slot/terminal64.exe" --port "$port" --token-file "Z:/srv/mt5/bridge.token" &
# Wine's launcher returns once the desktop is up, so it can't be what systemd
# watches. The unit is alive for as long as the bridge answers on its port.
for _ in $(seq 1 60); do ss -ltn | grep -q ":$port " && break; sleep 1; done
stuck=0
while ss -ltn | grep -q ":$port "; do
  sleep 5
  # A bridge whose terminal has stopped answering holds its one call for ever,
  # and still listens. /alive answers without the terminal and says how long
  # the call in hand has had it: nothing honest takes two and a half minutes.
  #
  # No answer at all is given as long: while a terminal is being started the
  # MetaTrader call holds the whole bridge, /alive included, and a terminal's
  # very first start (a new slot, nothing downloaded yet) takes a minute or
  # more on a busy server. Fifteen seconds of silence used to count as stuck,
  # so a new slot was restarted in the middle of every first start, for ever.
  busy=$(curl -s -m 4 -H "X-Bridge-Token: $token" "http://127.0.0.1:$port/alive" | sed -n 's/.*"busyFor": *\([0-9]*\).*/\1/p')
  if [ -z "$busy" ]; then stuck=$((stuck + 1)); elif [ "$busy" -ge 150 ]; then stuck=30; else stuck=0; fi
  if [ "$stuck" -ge 30 ]; then echo "bridge $slot is stuck (busy for ${busy:-?}s): restarting"; exit 1; fi
done
echo "bridge $slot is no longer listening on $port"
exit 1
