# Full Software Documentation

## 1. What This Software Is

This project is a Node.js + Express server for a CS2 broadcast / overlay workflow.

Its main job is to:

1. Receive live CS2 GSI snapshots on POST `/`
2. Keep live in-memory match state
3. Transform raw GSI snapshots into broadcast-friendly JSON
4. Serve legacy admin/UI endpoints
5. Maintain a registry of teams and players
6. Finalize matches into postmatch storage
7. Rebuild aggregated team/player/head-to-head statistics from completed matches

In practice, this software acts as a data backend for:

1. Live scoreboard overlays
2. Prematch graphics
3. Postmatch graphics
4. Roster/titling systems
5. Admin tools for managing teams and players
6. Historical stats and completed match browsing

The main entrypoint is [server.js](/c:/RR/WayWayWay-main/server.js).

## 2. Runtime Stack

Defined in [package.json](/c:/RR/WayWayWay-main/package.json):

1. `express` for HTTP API
2. `ws` for WebSocket observer updates
3. `body-parser` for JSON and form bodies
4. `multer` for uploads
5. `xlsx` for Excel imports
6. `cors` for cross-origin API access
7. `ejs` for admin pages
8. `adm-zip`, `fs-extra`, `pg` are installed in the project dependencies

The server starts with:

1. `node server.js`
2. Port defaults to `2727`, or `process.env.PORT`

## 3. Main Modules

### 3.1 Core server

[server.js](/c:/RR/WayWayWay-main/server.js)

Responsibilities:

1. Starts Express app
2. Starts WebSocket server
3. Receives GSI data
4. Maintains live scoreboard state
5. Calculates live derived metrics
6. Serves all legacy, stats, admin, and graphics endpoints

### 3.2 Graphics utils

[lib/graphics-utils.js](/c:/RR/WayWayWay-main/lib/graphics-utils.js)

Responsibilities:

1. Resolve players by SteamID
2. Resolve teams by id/name
3. Build full player/team graphics profiles
4. Build photo/logo fallback URLs
5. Normalize registered DB entities into overlay-safe JSON

### 3.3 Match finalization

[lib/match-finalization.js](/c:/RR/WayWayWay-main/lib/match-finalization.js)

Responsibilities:

1. Convert live match state into final postmatch structure
2. Determine winner
3. Build final players list
4. Build top players and MVP
5. Save finalized match to storage

### 3.4 Historical stats system

[stats.js](/c:/RR/WayWayWay-main/stats.js)

Responsibilities:

1. Maintain an additional stats model from GSI
2. Persist global player/team/map stats into `stats.json`
3. Track current match and historical match snapshots

Note: the current production flow is centered primarily around [server.js](/c:/RR/WayWayWay-main/server.js) graphics endpoints and storage JSON files.

## 4. Data Sources The Software Uses

### 4.1 CS2 GSI input

The server receives live GSI snapshots on POST `/`.

Main GSI fields used:

1. `map.round`
2. `map.phase`
3. `map.round_wins`
4. `map.team_ct`
5. `map.team_t`
6. `allplayers`
7. `player`
8. `match_stats.kills`
9. `match_stats.deaths`
10. `match_stats.assists`
11. `state.round_kills`
12. `state.round_killhs`
13. `state.round_totaldmg`
14. `state.health`
15. `weapons.*.name`
16. `weapons.*.type`
17. `weapons.*.state`

Important: GSI is treated as snapshot input, not as a full event log.

That means this software derives advanced statistics using delta tracking between snapshots.

### 4.2 Registered static data

Stored in [data.json](/c:/RR/WayWayWay-main/data.json).

This is the internal registry of:

1. Teams
2. Players

Typical team fields used across the software:

1. `id`
2. `name`
3. `shortName`
4. `tag`
5. `logo`
6. `country`
7. `countryCode`

Typical player fields used across the software:

1. `id`
2. `name`
3. `nickname`
4. `steamId`
5. `photo`
6. `teamId`
7. `firstName`
8. `lastName`
9. `country`
10. `countryCode`
11. `role`

### 4.3 Persistent storage JSON

Stored under [storage](/c:/RR/WayWayWay-main/storage).

Files used:

1. [storage/postmatch.json](/c:/RR/WayWayWay-main/storage/postmatch.json)
2. [storage/completedMatches.json](/c:/RR/WayWayWay-main/storage/completedMatches.json)
3. [storage/liveMatch.json](/c:/RR/WayWayWay-main/storage/liveMatch.json)
4. [storage/teamStats.json](/c:/RR/WayWayWay-main/storage/teamStats.json)
5. [storage/playerStats.json](/c:/RR/WayWayWay-main/storage/playerStats.json)
6. [storage/mapStats.json](/c:/RR/WayWayWay-main/storage/mapStats.json)
7. [storage/headToHead.json](/c:/RR/WayWayWay-main/storage/headToHead.json)

## 5. Internal In-Memory Runtime State

The server keeps several live structures in memory.

### 5.1 `scoreboard`

Primary live GSI state:

1. `scoreboard.players`
2. `scoreboard.map`
3. `scoreboard.player`

### 5.2 `roundsHistory`

Round-by-round winner history for overlays.

### 5.3 `roundsAlive`

Round alive-state snapshots.

### 5.4 `overallRoundTracker`

Tracks per-player per-round derived data:

1. `killsByRound`
2. `damageByRound`
3. `survivedByRound`
4. `kastByRound`

### 5.5 `gsiKillTracker`

Tracks per-player delta-derived advanced stats:

1. previous kills/deaths/assists
2. previous round kills/headshots/damage
3. last active weapon
4. matchStats
5. roundStats
6. trackerWarnings

### 5.6 `clutchTrackerState`

Tracks pending/confirmed clutches:

1. `currentRound`
2. `roundAttempts`
3. `pendingRounds`
4. `previousScore`
5. `unresolvedWarnings`

## 6. What Happens On Each GSI POST `/`

When CS2 sends a snapshot to POST `/`, the server does the following:

1. Updates `scoreboard.map`
2. Updates `scoreboard.players` from `allplayers`
3. Updates observer player state from `player`
4. Maintains accumulated damage per player
5. Updates per-round trackers
6. Runs GSI delta tracking for advanced stats
7. Tracks opening kills/deaths
8. Tracks multikills
9. Tracks headshots
10. Tracks weapon kills best-effort
11. Tracks clutch attempts/wins/losses
12. Updates `roundsHistory`
13. Updates `roundsAlive`
14. Refreshes `lastScoreboardUpdate`

## 7. Statistics Currently Calculated For Players

These are the live enriched statistics used by scoreboard/postmatch.

### 7.1 Identity and team info

1. `id`
2. `steamId`
3. `nickname`
4. `name`
5. `firstName`
6. `lastName`
7. `fullName`
8. `First Name Last Name`
9. `photo`
10. `teamId`
11. `teamName`
12. `teamLogo`
13. `side`
14. `scoreboardRank`
15. `isPlaceholder`

### 7.2 Basic match stats

1. `kills`
2. `deaths`
3. `assists`
4. `plusMinus`
5. `kd`
6. `kda`
7. `dpr`

### 7.3 Damage and pace

1. `damage`
2. `damageTotal`
3. `damageCurrentRound`
4. `damagePreviousRound`
5. `damageByRound`
6. `adr`
7. `kpr`
8. `apr`
9. `damagePerKill`

### 7.4 Survival

1. `roundsPlayed`
2. `survivedRounds`
3. `survivedRoundsCount`
4. `survivalRate`
5. `survivalPercentage`

### 7.5 Multikills

1. `multiKills_1k`
2. `multiKills_2k`
3. `multiKills_3k`
4. `multiKills_4k`
5. `multiKills_5k`
6. `multiKills_aces`
7. `multiKills_total`

Nested object also exists:

1. `multiKills.oneKillRounds`
2. `multiKills.twoKillRounds`
3. `multiKills.threeKillRounds`
4. `multiKills.fourKillRounds`
5. `multiKills.fiveKillRounds`
6. `multiKills.twoKCount`
7. `multiKills.threeKCount`
8. `multiKills.fourKCount`
9. `multiKills.fiveKCount`
10. `multiKills.aces`
11. `multiKills.totalMultiKillRounds`

### 7.6 Headshots

1. `hsCount`
2. `hsPercentage`
3. `headshots_count`
4. `headshots_rate`
5. `headshots_percentage`

Nested object also exists:

1. `headshots.count`
2. `headshots.rate`
3. `headshots.percentage`
4. `headshots.available`

### 7.7 Opening stats

1. `opening_firstKills`
2. `opening_firstDeaths`
3. `opening_kpr`
4. `openingKpr`
5. `opening_entryDiff`

Nested object also exists:

1. `opening.firstKills`
2. `opening.firstDeaths`
3. `opening.openingKpr`
4. `opening.entryDiff`
5. `opening.available`

### 7.8 Weapon kill stats

1. `awpKills`
2. `awpKpr`
3. `rifleKills`
4. `pistolKills`
5. `knifeKills`
6. `zeusKills`
7. `smgKills`
8. `weaponUnknownKills`

Nested object also exists:

1. `weapons.awpKills`
2. `weapons.awpKpr`
3. `weapons.rifleKills`
4. `weapons.pistolKills`
5. `weapons.knifeKills`
6. `weapons.zeusKills`
7. `weapons.smgKills`
8. `weapons.unknownKills`
9. `weapons.available`

### 7.9 Clutch stats

1. `clutches_attempts`
2. `clutches_wins`
3. `clutches_losses`
4. `clutches_1v1_attempts`
5. `clutches_1v1_wins`
6. `clutches_1v1_losses`
7. `clutches_1v2_attempts`
8. `clutches_1v2_wins`
9. `clutches_1v2_losses`
10. `clutches_1v3_attempts`
11. `clutches_1v3_wins`
12. `clutches_1v3_losses`
13. `clutches_1v4_attempts`
14. `clutches_1v4_wins`
15. `clutches_1v4_losses`
16. `clutches_1v5_attempts`
17. `clutches_1v5_wins`
18. `clutches_1v5_losses`
19. `clutches_oneVsOne`
20. `clutches_oneVsTwo`
21. `clutches_oneVsThree`
22. `clutches_oneVsFour`
23. `clutches_oneVsFive`
24. `clutchWinRate`

Nested object also exists:

1. `clutches.attempts`
2. `clutches.wins`
3. `clutches.losses`
4. `clutches.oneVsOne`
5. `clutches.oneVsTwo`
6. `clutches.oneVsThree`
7. `clutches.oneVsFour`
8. `clutches.oneVsFive`
9. `clutches.oneVsOneWins`
10. `clutches.oneVsTwoWins`
11. `clutches.oneVsThreeWins`
12. `clutches.oneVsFourWins`
13. `clutches.oneVsFiveWins`
14. `clutches.oneVsOneLosses`
15. `clutches.oneVsTwoLosses`
16. `clutches.oneVsThreeLosses`
17. `clutches.oneVsFourLosses`
18. `clutches.oneVsFiveLosses`
19. `clutches.winRate`
20. `clutches.available`

### 7.10 Rating fields

1. `rating`
2. `customRating`

### 7.11 Fields currently intentionally not trusted as real event-accurate live data

These fields are kept but currently returned as unavailable/null in live enriched scoreboard logic:

1. utility event stats
2. real KAST
3. real Impact

Utility fields present in shape:

1. `flashAssists`
2. `flashesThrown`
3. `enemiesFlashed`
4. `smokesThrown`
5. `heThrown`
6. `molotovsThrown`
7. `utilityDamage`

Nested utility object also exists:

1. `utility.flashAssists`
2. `utility.flashesThrown`
3. `utility.enemiesFlashed`
4. `utility.smokesThrown`
5. `utility.heThrown`
6. `utility.molotovsThrown`
7. `utility.utilityDamage`
8. `utility.available`

## 8. PlayersTable Output

For table/data-source use, the software provides object-free primitive arrays:

1. `playersTable`
2. `teamAPlayersTable`
3. `teamBPlayersTable`

These are used to avoid `[object Object]` issues in overlay data tables.

Current primitive fields in each row:

1. `steamId`
2. `nickname`
3. `firstName`
4. `lastName`
5. `fullName`
6. `First Name Last Name`
7. `teamName`
8. `side`
9. `kills`
10. `deaths`
11. `assists`
12. `plusMinus`
13. `kd`
14. `dpr`
15. `kda`
16. `damageTotal`
17. `damageCurrentRound`
18. `damagePreviousRound`
19. `adr`
20. `kpr`
21. `apr`
22. `roundsPlayed`
23. `survivedRounds`
24. `survivalRate`
25. `multiKills_1k`
26. `multiKills_2k`
27. `multiKills_3k`
28. `multiKills_4k`
29. `multiKills_5k`
30. `multiKills_aces`
31. `multiKills_total`
32. `hsCount`
33. `hsPercentage`
34. `opening_firstKills`
35. `opening_firstDeaths`
36. `openingKpr`
37. `opening_entryDiff`
38. `awpKills`
39. `awpKpr`
40. `rifleKills`
41. `pistolKills`
42. `knifeKills`
43. `zeusKills`
44. `smgKills`
45. `weaponUnknownKills`
46. `clutches_attempts`
47. `clutches_wins`
48. `clutches_losses`
49. `clutches_1v1_attempts`
50. `clutches_1v1_wins`
51. `clutches_1v1_losses`
52. `clutches_1v2_attempts`
53. `clutches_1v2_wins`
54. `clutches_1v2_losses`
55. `clutches_1v3_attempts`
56. `clutches_1v3_wins`
57. `clutches_1v3_losses`
58. `clutches_1v4_attempts`
59. `clutches_1v4_wins`
60. `clutches_1v4_losses`
61. `clutches_1v5_attempts`
62. `clutches_1v5_wins`
63. `clutches_1v5_losses`
64. `clutchWinRate`
65. `customRating`
66. `scoreboardRank`
67. `isPlaceholder`

## 9. Debug / Data Quality Output

The graphics scoreboard and postmatch include `statsDebug`.

Current `statsDebug` fields:

1. `trackedPlayersCount`
2. `hasRoundKills`
3. `hasRoundKillHs`
4. `hasRoundTotalDmg`
5. `weaponTrackingAvailable`
6. `unavailableStats`
7. `warnings`

Warnings may include:

1. `kills_mismatch:<steamId>`
2. `damageCurrentRound_mismatch:<steamId>`
3. `hs_gt_kills:<steamId>`
4. `damagePreviousRound_missing:<steamId>`
5. `weaponKills_gt_kills:<steamId>`
6. `multikill_total_mismatch:<steamId>`
7. `aces_gt_rounds:X>Y`
8. `steamid_key_mismatch:<scoreboardKey>:<payloadSteamId>`
9. `weapon_delta_gt1:<steamId>:delta=<n>`
10. `clutch_pending_round_<round>`
11. `clutch_winner_unknown_round_<round>`

## 10. Legacy Public Endpoints

These endpoints expose live or admin-facing data outside the newer graphics API.

### Live/raw data

1. `POST /` — receive CS2 GSI snapshot
2. `GET /gsi` — raw in-memory scoreboard
3. `GET /scoreboard` — alias of raw scoreboard
4. `GET /score` — legacy formatted scoreboard response
5. `GET /alive` — alive player history by round
6. `GET /observer` — observed player payload
7. `GET /teams` — team summary page/data
8. `GET /rounds` — round history
9. `GET /mvp` — MVP summary

### Admin / pages

1. `GET /admin`
2. `GET /admin/graphics`
3. `GET /stats`
4. `GET /maps`
5. `GET /stats/player`
6. `GET /stats/team`
7. `GET /admin-test`
8. `GET /admin-simple`
9. `GET /admin-fixed`

## 11. CRUD / Registry Endpoints

### Teams

1. `GET /api/teams`
2. `GET /api/teams/:id`
3. `POST /api/teams`
4. `PUT /api/teams/:id`
5. `DELETE /api/teams/:id`
6. `POST /api/teams/uploadLogo`

### Players

1. `GET /api/players`
2. `GET /api/players/:id`
3. `POST /api/players`
4. `PUT /api/players/:id`
5. `DELETE /api/players/:id`
6. `POST /api/players/uploadPhoto`

### Import / export

1. `GET /api/export/teams`
2. `GET /api/export/players`
3. `POST /api/import/teams`
4. `POST /api/import/players`

## 12. Stats API Endpoints

1. `GET /api/stats/match`
2. `GET /api/stats/players`
3. `GET /api/stats/teams`
4. `GET /api/stats/history`
5. `GET /api/stats/history/:id`
6. `DELETE /api/stats/history/:id`
7. `GET /api/stats/global`
8. `GET /api/stats/maps`
9. `GET /api/stats/player/:steamId`
10. `GET /api/stats/team/:name`

## 13. Graphics API Endpoints

These are the main broadcast-facing JSON endpoints.

### 13.1 Live scoreboard / live match

1. `GET /api/graphics/scoreboard`
2. `GET /api/graphics/live`

Scoreboard response contains:

1. `mode`
2. `type`
3. `matchId`
4. `map`
5. `round`
6. `phase`
7. `updatedAt`
8. `teamA`
9. `teamB`
10. `sides`
11. `players`
12. `playersTable`
13. `teamAPlayers`
14. `teamBPlayers`
15. `teamAPlayersTable`
16. `teamBPlayersTable`
17. `teams`
18. `topPlayers`
19. `statAvailability`
20. `statsDebug`

### 13.2 Team and player directory

1. `GET /api/graphics/teams`
2. `GET /api/graphics/team/:teamId`
3. `GET /api/graphics/players`

### 13.3 Prematch

1. `GET /api/graphics/prematch`

Modes:

1. No params: full prematch database mode
2. `teamA` + `teamB`: comparison mode

### 13.4 Postmatch

1. `GET /api/graphics/postmatch`
2. `GET /api/graphics/match/:matchId/final`

Postmatch enriched response contains:

1. finalized match metadata
2. players
3. playersTable
4. teamAPlayers
5. teamBPlayers
6. teamAPlayersTable
7. teamBPlayersTable
8. mvp
9. topPlayers
10. statAvailability
11. statsDebug
12. teamStats

### 13.5 Player stats payloads

1. `GET /api/graphics/player-stats/live`
2. `GET /api/graphics/player-stats/postmatch`
3. `GET /api/graphics/player-stats/live/compact`
4. `GET /api/graphics/player-stats/postmatch/compact`
5. `GET /api/graphics/player-stats/:matchId`

### 13.6 Health and validation

1. `GET /api/graphics/health`
2. `GET /api/graphics/validate`

### 13.7 Rosters

1. `GET /api/graphics/rosters`
2. `GET /api/graphics/rosters/compact`
3. `GET /api/graphics/rosters/:teamId`

### 13.8 Match lists and history

1. `GET /api/graphics/matches/upcoming`
2. `GET /api/graphics/matches/live`
3. `GET /api/graphics/matches/completed`
4. `GET /api/graphics/matches`
5. `GET /api/graphics/match/:matchId`

### 13.9 Full database dump

1. `GET /api/graphics/database`

Database response includes:

1. teams
2. players
3. rosters
4. matches
5. completedMatches
6. stats.teams
7. stats.players
8. stats.maps
9. stats.headToHead
10. assets.teamLogos
11. assets.playerPhotos
12. assets.fallbacks

## 14. Admin Graphics Maintenance Endpoints

1. `POST /api/admin/finalize-match`
2. `POST /api/admin/rebuild-stats`
3. `POST /api/admin/graphics/clear-postmatch`
4. `POST /api/admin/graphics/clear-live`
5. `POST /api/admin/graphics/clear-completed-test`

## 15. What The Software Stores In Persistent JSON

### 15.1 postmatch.json

Contains the latest finalized match in enriched graphics shape.

### 15.2 completedMatches.json

Contains historical finalized matches.

### 15.3 liveMatch.json

Contains a persisted live match snapshot / cache layer.

### 15.4 teamStats.json

Contains aggregated team-level history, usually:

1. matchesPlayed
2. wins
3. losses
4. winRate
5. mapsPlayed
6. mapsWon
7. mapsLost
8. mapWinRate
9. currentStreak
10. lastMatches

### 15.5 playerStats.json

Contains aggregated player-level history, usually:

1. matchesPlayed
2. mapsPlayed
3. kills
4. deaths
5. assists
6. damage
7. kd
8. adr
9. rating
10. lastMatches

### 15.6 mapStats.json

Contains map-level aggregate statistics.

### 15.7 headToHead.json

Contains team-vs-team aggregate history.

## 16. WebSocket Layer

The software also starts a WebSocket server from [server.js](/c:/RR/WayWayWay-main/server.js).

Purpose:

1. Push current observer player updates to connected clients
2. Broadcast observer state derived from live scoreboard / observer slot

## 17. Admin Views

EJS views found in [views](/c:/RR/WayWayWay-main/views):

1. [views/admin.ejs](/c:/RR/WayWayWay-main/views/admin.ejs) — main admin panel for team/player management
2. [views/admin-graphics.ejs](/c:/RR/WayWayWay-main/views/admin-graphics.ejs) — graphics API preview / testing panel
3. [views/admin_fixed.ejs](/c:/RR/WayWayWay-main/views/admin_fixed.ejs)
4. [views/admin_new.ejs](/c:/RR/WayWayWay-main/views/admin_new.ejs)
5. [views/admin_simple.ejs](/c:/RR/WayWayWay-main/views/admin_simple.ejs)
6. [views/admin_test.ejs](/c:/RR/WayWayWay-main/views/admin_test.ejs)
7. [views/maps.ejs](/c:/RR/WayWayWay-main/views/maps.ejs)
8. [views/stats.ejs](/c:/RR/WayWayWay-main/views/stats.ejs)
9. [views/stats-player.ejs](/c:/RR/WayWayWay-main/views/stats-player.ejs)
10. [views/stats-team.ejs](/c:/RR/WayWayWay-main/views/stats-team.ejs)

## 18. Main Limitations / Reliability Notes

Because CS2 GSI is snapshot-based, not event-log based, some statistics are reliable only as best-effort.

### Reliable or mostly reliable from delta tracking

1. kills
2. deaths
3. assists
4. damage total/current/previous round
5. ADR
6. headshots from `round_killhs`
7. opening first kills / first deaths
8. multikill buckets from `round_kills`
9. weapon kills best-effort when `killDelta === 1`
10. clutch attempts/wins/losses from alive-state and round winner resolution

### Deliberately conservative / limited

1. weapon split becomes `weaponUnknownKills` when kill delta jumps by more than 1
2. utility stats are not treated as reliable event-level live truth
3. real KAST is not treated as reliable
4. real Impact is not treated as reliable

## 19. Practical Summary

In short, this software is a complete CS2 broadcast data backend.

It:

1. receives GSI
2. tracks live match state
3. resolves players and teams from registry data
4. calculates advanced live scoreboard stats
5. serves overlay-friendly JSON
6. finalizes matches into postmatch storage
7. rebuilds historical aggregates
8. provides admin/import/export/validation tooling

The most important live JSON products are:

1. `/api/graphics/scoreboard`
2. `/api/graphics/postmatch`
3. `/api/graphics/prematch`
4. `/api/graphics/rosters`
5. `/api/graphics/database`
