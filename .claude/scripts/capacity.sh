#!/bin/sh
# How many stories this machine can carry right now.
#
# Concurrency is a machine question, not a coordination one, and it is not a
# constant. This prints a number between 1 and 6, the reason it is that number,
# and the raw measurements it came from, so the decision can be argued with.
#
#   sh .claude/scripts/capacity.sh          # 5s sample
#   sh .claude/scripts/capacity.sh 15       # 15s sample, steadier under a spike
#
# Exit code is the recommended slot count, so `sh capacity.sh; n=$?` works.

set -u

WINDOW="${1:-5}"
CEILING=6

NCPU=$(sysctl -n hw.ncpu)
MEMBYTES=$(sysctl -n hw.memsize)

swap_used_mb() {
  # vm.swapusage: "total = 12288.00M  used = 11319.69M  free = 968.31M"
  sysctl -n vm.swapusage | awk '{for(i=1;i<=NF;i++) if($i=="used"){gsub(/M$/,"",$(i+2)); print $(i+2); exit}}'
}

SWAP1=$(swap_used_mb)
sleep "$WINDOW"
SWAP2=$(swap_used_mb)

# Kernel's own verdict: 1 normal, 2 warning, 4 critical. This is the signal to
# trust over any of the others, because it is what the OS itself acts on.
PRESSURE=$(sysctl -n kern.memorystatus_vm_pressure_level 2>/dev/null || echo 1)

# memory_pressure prints "System-wide memory free percentage: 31%"
FREEPCT=$(memory_pressure -Q 2>/dev/null | awk '/free percentage/{gsub(/%/,"",$NF); print $NF; exit}')
[ -n "${FREEPCT:-}" ] || FREEPCT=100

LOAD1=$(sysctl -n vm.loadavg | awk '{print $2}')

# Per-core load and swap delta as integers, so the comparisons below stay in sh.
LOADX100=$(awk -v l="$LOAD1" -v n="$NCPU" 'BEGIN{printf "%d", (l/n)*100}')
SWAPDELTA=$(awk -v a="$SWAP1" -v b="$SWAP2" 'BEGIN{printf "%d", b-a}')
SWAPRATE=$(awk -v d="$SWAPDELTA" -v w="$WINDOW" 'BEGIN{printf "%d", d*60/w}')

SLOTS=$CEILING
REASON="headroom is fine"

cap() { # cap <n> <reason>
  if [ "$1" -lt "$SLOTS" ]; then SLOTS=$1; REASON="$2"; fi
}

# Free memory. The percentages are the machine's, not a rule of thumb: below
# 20% free this laptop starts paging out things the user is actively using,
# which is the state where it stops being usable for anything else.
[ "$FREEPCT" -lt 40 ] && cap 4 "only ${FREEPCT}% of memory free"
[ "$FREEPCT" -lt 30 ] && cap 3 "only ${FREEPCT}% of memory free"
[ "$FREEPCT" -lt 20 ] && cap 2 "only ${FREEPCT}% of memory free"
[ "$FREEPCT" -lt 10 ] && cap 1 "only ${FREEPCT}% of memory free"

# Load per core. One story is an orchestrator plus one or two engineers, mostly
# waiting on a model, but a test suite or a build is CPU-bound for minutes.
[ "$LOADX100" -gt 100 ] && cap 4 "load is $(awk -v x=$LOADX100 'BEGIN{printf "%.1f", x/100}')x cores"
[ "$LOADX100" -gt 150 ] && cap 3 "load is $(awk -v x=$LOADX100 'BEGIN{printf "%.1f", x/100}')x cores"
[ "$LOADX100" -gt 200 ] && cap 2 "load is $(awk -v x=$LOADX100 'BEGIN{printf "%.1f", x/100}')x cores"
[ "$LOADX100" -gt 300 ] && cap 1 "load is $(awk -v x=$LOADX100 'BEGIN{printf "%.1f", x/100}')x cores"

# Swap GROWTH, not swap used. Used never falls on macOS: pages stay in swap
# until something touches them, so a machine that recovered an hour ago still
# reads 11 GB used. Growth is the only part of it that means anything.
[ "$SWAPRATE" -gt 60 ]  && cap 3 "swap growing ${SWAPRATE} MB/min"
[ "$SWAPRATE" -gt 240 ] && cap 2 "swap growing ${SWAPRATE} MB/min"
[ "$SWAPRATE" -gt 600 ] && cap 1 "swap growing ${SWAPRATE} MB/min, the machine is actively thrashing"

# The kernel's verdict last, so it wins ties.
[ "$PRESSURE" -ge 2 ] && cap 3 "kernel memory pressure is WARN"
[ "$PRESSURE" -ge 4 ] && cap 1 "kernel memory pressure is CRITICAL"

REGISTRY=".claude/registry.json"
INFLIGHT=0
if [ -f "$REGISTRY" ]; then
  INFLIGHT=$(grep -c '"state": "in-progress"' "$REGISTRY" 2>/dev/null || echo 0)
fi
HEADROOM=$((SLOTS - INFLIGHT))
[ "$HEADROOM" -lt 0 ] && HEADROOM=0

printf 'SLOTS: %d   (%s)\n' "$SLOTS" "$REASON"
printf 'in flight: %d   dispatch %d more\n' "$INFLIGHT" "$HEADROOM"
printf '\n'
printf '  cores          %s\n' "$NCPU"
printf '  memory         %s GB\n' "$((MEMBYTES / 1073741824))"
printf '  free           %s%%\n' "$FREEPCT"
printf '  pressure       %s   (1 normal, 2 warn, 4 critical)\n' "$PRESSURE"
printf '  load 1min      %s   (%s per core)\n' "$LOAD1" "$(awk -v x=$LOADX100 'BEGIN{printf "%.2f", x/100}')"
printf '  swap used      %s MB\n' "$SWAP2"
printf '  swap growth    %s MB over %ss   (%s MB/min)\n' "$SWAPDELTA" "$WINDOW" "$SWAPRATE"

exit "$SLOTS"
