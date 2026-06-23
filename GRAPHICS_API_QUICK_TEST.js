#!/usr/bin/env node

/**
 * Quick Test Guide for GGBB Graphics Endpoints
 * 
 * This file documents the endpoints and example curl/PowerShell commands
 * to test the new broadcast graphics API
 * 
 * NOTE: These are pseudo-commands. Actual testing depends on your environment.
 */

// ==========================================
// ENDPOINT SUMMARY
// ==========================================

const endpoints = [
  {
    name: "Legacy Scoreboard (Unchanged)",
    method: "GET",
    path: "/score",
    description: "Legacy endpoint - still works exactly as before",
    response: {
      mapInfo: { CT: { name, score }, T: { name, score } },
      players: [ { steamId, name, kills, deaths, assists, adr, team, photo, teamName } ]
    }
  },

  {
    name: "Live Scoreboard (NEW)",
    method: "GET",
    path: "/api/graphics/scoreboard",
    description: "New graphics-ready scoreboard with all 10 players, logos, photos",
    response: {
      mode: "live",
      map: "de_mirage",
      round: 14,
      phase: "live",
      teamA: { id, name, shortName, logo, score, side, players },
      teamB: { id, name, shortName, logo, score, side, players },
      players: [ 10 player objects with steamId, photo, teamLogo, kills, adr, etc ],
      topPlayers: { kills: [], adr: [], damage: [] }
    }
  },

  {
    name: "All Teams",
    method: "GET",
    path: "/api/graphics/teams",
    description: "List all teams with player rosters",
    response: {
      teams: [
        {
          id: "team_001",
          name: "G2 Esports",
          shortName: "G2",
          logo: "http://...",
          players: [ { id, steamId, name, nickname, photo } ],
          stats: { matchesPlayed, wins, losses, winRate, ... }
        }
      ]
    }
  },

  {
    name: "Single Team Detail",
    method: "GET",
    path: "/api/graphics/team/:teamId",
    description: "Get specific team with complete info",
    example: "/api/graphics/team/team_001"
  },

  {
    name: "Prematch",
    method: "GET",
    path: "/api/graphics/prematch?teamA=team_001&teamB=team_002",
    description: "Pre-match comparison for two teams",
    response: {
      mode: "prematch",
      teamA: { ...team, players, stats, mapStats },
      teamB: { ...team, players, stats, mapStats },
      headToHead: { matchesPlayed, teamAWins, teamBWins },
      maps: { de_mirage: { teamAWinRate, teamBWinRate } }
    }
  },

  {
    name: "Postmatch Result",
    method: "GET",
    path: "/api/graphics/postmatch",
    description: "Last completed match result (updated after finalize)",
    response: {
      mode: "postmatch",
      matchId: "match_001",
      map: "de_mirage",
      teamA: { name, logo, score, result: "winner" },
      teamB: { name, logo, score, result: "loser" },
      players: [ 10 final player stats ],
      topPlayers: { kills: [], adr: [], rating: [] },
      mvp: { name, photo, rating }
    }
  },

  {
    name: "Specific Match Final",
    method: "GET",
    path: "/api/graphics/match/:matchId/final",
    description: "Get specific match result from history",
    example: "/api/graphics/match/match_001/final"
  },

  {
    name: "Finalize Match (Admin)",
    method: "POST",
    path: "/api/admin/finalize-match",
    description: "Call when match ends - captures current state to postmatch",
    body: { matchId: "match_001" },
    response: { success: true, matchId: "match_001", data: { postmatch } }
  }
];

// ==========================================
// TEST EXAMPLES
// ==========================================

console.log(`
===========================================
GGBB Graphics API - Testing Guide
===========================================

Use these commands to test the endpoints:

## PowerShell Tests

# Test 1: Legacy endpoint (should still work)
Invoke-RestMethod -Uri "http://localhost:2727/score" -Method Get

# Test 2: New graphics scoreboard
Invoke-RestMethod -Uri "http://localhost:2727/api/graphics/scoreboard" -Method Get

# Test 3: All teams
Invoke-RestMethod -Uri "http://localhost:2727/api/graphics/teams" -Method Get

# Test 4: Specific team (replace team_001 with real ID)
Invoke-RestMethod -Uri "http://localhost:2727/api/graphics/team/team_001" -Method Get

# Test 5: Prematch (replace team IDs with real ones)
Invoke-RestMethod -Uri "http://localhost:2727/api/graphics/prematch?teamA=1741167069740&teamB=1741167466408" -Method Get

# Test 6: Postmatch (will be empty until you finalize a match)
Invoke-RestMethod -Uri "http://localhost:2727/api/graphics/postmatch" -Method Get

# Test 7: Finalize match
$body = @{ matchId = "match_001" } | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:2727/api/admin/finalize-match" -Method Post -Body $body -ContentType "application/json"

## Curl Tests (if available)

# Test 1: Legacy
curl http://localhost:2727/score

# Test 2: Graphics scoreboard
curl http://localhost:2727/api/graphics/scoreboard

# Test 3: Teams
curl http://localhost:2727/api/graphics/teams

# Test 4: Finalize (with jq to format)
curl -X POST http://localhost:2727/api/admin/finalize-match \\
  -H "Content-Type: application/json" \\
  -d '{"matchId":"match_001"}' | jq .

===========================================
BINDING EXAMPLES FOR GB NEXT GEN OVERLAY
===========================================

## Team Bindings
{{teamA.name}}
{{teamA.shortName}}
{{teamA.logo}}
{{teamA.score}}
{{teamA.side}}

## Player Bindings (from live scoreboard)
{{players.0.name}}
{{players.0.photo}}
{{players.0.kills}}
{{players.0.deaths}}
{{players.0.adr}}
{{players.0.teamLogo}}

## Top Players
{{topPlayers.kills.0.name}}
{{topPlayers.kills.0.photo}}
{{topPlayers.kills.0.kills}}

{{topPlayers.adr.0.name}}
{{topPlayers.adr.0.adr}}

## MVP (after finalize)
{{mvp.name}}
{{mvp.photo}}
{{mvp.rating}}

===========================================
DATA PERSISTENCE
===========================================

- Postmatch data saved in: storage/postmatch.json
- Match history in: storage/completedMatches.json
- Postmatch persists until next finalize is called
- Old data backed up in completedMatches array

===========================================
TROUBLESHOOTING
===========================================

Problem: Players missing photos
→ Photos fall back to /NoneP.png if not registered
→ Register players in admin panel to add photos

Problem: Team logos not appearing  
→ Logos fall back to /logos/none-team.png if not found
→ Upload logos in Teams admin section

Problem: /api/graphics/scoreboard returns empty players
→ GSI data not arriving yet
→ Start a CS2 match with GSI enabled
→ Endpoints will populate as GSI updates arrive

Problem: Postmatch data empty
→ Must call POST /api/admin/finalize-match
→ Will be added as admin button in Phase 6

===========================================
METRICS AVAILABLE IN RESPONSE
===========================================

Live (from GSI):
✅ kills, deaths, assists, ADR, K/D ratio
✅ damage (accumulated), health, armor, money
✅ weapon, team, side
✅ isAlive status

Calculated (after finalize):
✅ Match winner/loser
✅ Top players by kills/ADR/damage
✅ MVP identification

NOT Available (Phase 5+):
❌ Rating (requires advanced calculation)
❌ KAST, Headshot%, Clutches
❌ Map winrates (requires match history)
❌ Team stats (requires aggregation)

===========================================
`);
