// SPDX-License-Identifier: AGPL-3.0-or-later
import { fetch as expoFetch } from "expo/fetch";

// React Native's built-in fetch ignores `redirect`; expo/fetch honours it on iOS and Android.
export const platformFetch = ((input, init) =>
  expoFetch(
    input as Parameters<typeof expoFetch>[0],
    init as Parameters<typeof expoFetch>[1],
  )) as typeof fetch;
