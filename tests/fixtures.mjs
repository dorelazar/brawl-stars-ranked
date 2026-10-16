// Small fake API responses in the official battle log format.

export const meta = {
  brawlers: [
    { id: 1, name: 'Shelly', cls: 'Damage Dealer' },
    { id: 2, name: 'Colt', cls: 'Damage Dealer' },
    { id: 3, name: 'Bull', cls: 'Tank' },
    { id: 4, name: 'Piper', cls: 'Marksman' },
    { id: 5, name: 'Mortis', cls: 'Assassin' },
    { id: 6, name: 'Poco', cls: 'Support' },
    { id: 7, name: 'Barley', cls: 'Artillery' },
    { id: 8, name: 'Gene', cls: 'Controller' },
  ],
  modes: [{ id: 'gemGrab', name: 'Gem Grab' }],
  maps: [{ id: 100, name: 'Hard Rock Mine', mode: 'gemGrab', active: true }],
};

const player = (tag, brawlerId) => ({ tag, name: tag, brawler: { id: brawlerId, name: `B${brawlerId}`, power: 11, trophies: 18 } });

export function battle({ time, type = 'soloRanked', mode = 'gemGrab', mapId = 100, map = 'Hard Rock Mine', teamA, teamB, ownerWon = true }) {
  return {
    battleTime: time,
    event: { id: mapId, mode, map },
    battle: {
      mode,
      type,
      result: ownerWon ? 'victory' : 'defeat',
      duration: 120,
      teams: [
        teamA.map((b, i) => player(`#A${i}${time}`, b)),
        teamB.map((b, i) => player(`#B${i}${time}`, b)),
      ],
    },
  };
}
