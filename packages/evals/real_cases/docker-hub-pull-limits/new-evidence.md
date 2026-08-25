# Docker Hub documents pull rate limits

Evidence date: 2026-04-01

Official source: https://docs.docker.com/docker-hub/usage/pulls/

Docker documents a six-hour pull limit for unauthenticated and Personal users.
The published limits are 100 pulls per IPv4 address or IPv6 /64 subnet for
unauthenticated users and 200 for authenticated Personal users. Paid Pro, Team,
and Business users receive unlimited pulls subject to fair use.

The documented limit weakens the assumption that anonymous CI pulls are
effectively unlimited and supports the planned authentication-or-mirror review.
