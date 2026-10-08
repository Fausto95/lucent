# 0047. Views without a switch

- **Date:** 2026-10-07
- **Status:** accepted

The maintainer removed the
internal `LUCENT_VIEWS=fabric` switch: every compile resolves `lucent:ui`,
the toolkits and JSX, and generates components' Fabric sources, so a
Lucent package with components (the expo-image and expo-video ports)
builds in any app. Views stay in preview until G3 certifies them. A
deferred Android build is configured for Compose only when the program
has components, so apps without views take no Compose dependency.
