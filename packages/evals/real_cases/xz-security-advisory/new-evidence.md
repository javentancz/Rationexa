# CVE-2024-3094 affected XZ Utils releases

Evidence date: 2024-03-29

Sources:

- https://www.openwall.com/lists/oss-security/2024/03/29/4
- https://nvd.nist.gov/vuln/detail/CVE-2024-3094

The oss-security disclosure reported malicious code in XZ Utils 5.6.0 and
5.6.1 release tarballs. The issue was assigned CVE-2024-3094 and could affect
SSH authentication in particular Linux distribution builds.

This evidence sharply weakens checksum-only trust in a recent upstream release
and supports the constraint favoring reviewed distribution packages. Exact
exposure still depends on the version and distribution build configuration.
