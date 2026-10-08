# 0033. CI jobs time out past their slowest runs

- **Date:** 2026-10-06
- **Status:** accepted

Each job
stops at two to three times its longest run on cold caches (the maxima of
the last hundred runs) rather than at GitHub's six hours, and the iOS
app's build step at 30 minutes, after which the job keeps xcodebuild's
whole log as an artifact. _Why:_ on 2026-10-05 an iOS simulator build
hung in xcodebuild for over 40 minutes, against 7 on average, holding one
of the five macOS runners while the other runs queued; its page showed
nothing, the output going through `tail`. _Changed:_ a hung job fails
within its limit; the SDK coverage step keeps its own 45 minutes, inside
its job's 75.
