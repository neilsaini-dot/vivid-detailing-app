---
name: Browser testing on Nix
description: Distinguish local Chromium dependency failures from application failures.
---

Downloaded Playwright browsers do not automatically inherit the shared-library setup of this Nix workspace. Installing the browser binary alone may not make it runnable.

**Why:** Chromium launch was blocked by missing shared libraries. Adding every Nix library directory to a global loader path introduced incompatible libc, C++ runtime, and shell-library versions instead of solving the browser dependency problem.

**How to apply:** Use managed browser dependencies or a browser-specific, compatible library environment. Never prepend all Nix library directories to the whole Node/shell process. Treat launch errors as test-infrastructure failures, not application regressions; report interactive checks as unverified rather than passed.