"use strict";

var _ = require("lodash");
var position = require("../../position.js");

// Paradroid
var botNames = [
  "001",
  "123",
  "139",
  "247",
  "249",
  "296",
  "302",
  "329",
  "420",
  "476",
  "493",
  "516",
  "571",
  "614",
  "615",
  "629",
  "711",
  "742",
  "751",
  "821",
  "834",
  "883",
  "999"
];

/*
 * 1. Study the general game characteristics: %
 *  - Tiling
 *   - [(r+1)*i-r*j r*i+(2*r+1)*j]
 *  - Movement template
 * 2. Define the information model.
 *  - How many scans needed to scan the whole field?
 *  - How many hits required for kill?
 *  - How many opponents, estimated HP, estimated locations.
 * 3. Define high level activities. %
 * 4. Define AI parameters.
 * 5. Optimize.
 * 
 * Potential things to consider:
 * - Genetic algorithms, Markov Decision Nets, Fuzzy Logic.
 * - Evasion. %
 * - Avoid team mates, formation. %
 * - Distance > radius*2 is safe, distance <= radius to avoid. Need to have range to scan the whole game area.
 */

module.exports = function Ai() {
  var game = {};
  const origo = {x: 0, y: 0};
  const AIParams = {
    probabilityForRandomTiling: process.env.PROB_RAND || 0.2,
    avoidRadaringBorders: process.env.AVOID_RAD_BORD || false,
    probabilityToAvoidTeam: process.env.PROB_AVOID_TEAM || 0.1,
    persist: process.env.PERSIST || true,
    randomFire: process.env.RANDOM_FIRE || true,
    evade: process.env.EVADE || true,
    noAvoidTeamAfterRound: process.env.EVADE_LIMIT || 30,
    avoidProb: process.env.AVOID_PROB || 1.0,
    persistScanDist: process.env.PERSIST_DIST || 4,
    avoidanceDistance: process.env.AVOID_DIST || 4
  };

  /*
   * {
   *   "type": "start",
   *   "you": {
   *     "name": <name of your team>,
   *     "teamId": <id of your team>,
   *     "bots": [<array of bots>]
   *   },
   *   "config": <configurations as an object>        
   *   "otherTeams": [<array of opponent teams>]
   * }
   */

  function resetRadarSweep() {
    game.tilesNotSwept = [];
    var R = game.config.radar;
    var F = game.config.fieldRadius;
    var tileRadius = Math.floor(F / R);
    var corners = [
      {x: 0, y: -F + R},
      {x: F - R, y: -F + R},
      {x: F - R, y: 0},
      {x: 0, y: F - R},
      {x: -F + R, y: F - R},
      {x: -F + R, y: 0}
    ];
    
    var randomCorner = _.shuffle(corners)[0];
    if (Math.random() < AIParams.probabilityForRandomTiling) {
      // We can occasionally take random tilings also.
      randomCorner = {
        x: randInt(-R, R),
        y: randInt(-R, R)
      };
    }
    
    for (var i = -tileRadius * 2 - 1; i <= tileRadius * 2 + 1; i++) for (var j = -tileRadius * 2 - 1; j <= tileRadius * 2 + 1; j++) {
      var tileCenter = {
          x: (R+1)*i-R*j + randomCorner.x,
          y: R*i+(2*R+1)*j + randomCorner.y
      };
      var maxRadarR = F - (R - 1);
      // F - (R - 1) means the whole radar fits to the field.
      // This might cause some issues occasionally.
      if (!AIParams.avoidRadaringBorders) {
        maxRadarR = F - 1;
      }
      if (distance(origo, tileCenter) < F - (R - 1)) {
        game.tilesNotSwept.push(tileCenter);
      }
    }
    game.tilesNotSwept = _.shuffle(game.tilesNotSwept);
  }

  function notAlreadyInQueue(tileCenter) {
    var notInQueue = _.find(game.tilesNotSwept, (tile) => distance(tileCenter, tile) < game.config.radar);
    return !notInQueue || notInQueue.length == 0;
  }
  
  function getTilesAround(pos) {
    var R = game.config.radar;
    var F = game.config.fieldRadius;
    var result = [pos];
    var i, j;
    if (Math.random() < 0.5) {
      i = 0;
      if (Math.random() < 0.5) {
        j = -1;
      } else {
        j = 1;
      }
    } else {
      j = 0;
      if (Math.random() < 0.5) {
        i = -1;
      } else {
        i = 1;
      }
    }
    var tileCenter = {
        x: (R+1)*i-R*j + pos.x,
        y: R*i+(2*R+1)*j + pos.y
    };
    var maxRadarR = F - (R - 1);
    if (distance(origo, tileCenter) <= F && notAlreadyInQueue(tileCenter)) {
      result.push(tileCenter);
    }
    return result;
  }
  
  function persist(coord, numBots) {
    if (numBots > 1) {
      game.tilesNotSwept.push(coord);
    } else {
      var tilesAround = getTilesAround(coord);
      Array.prototype.push(game.tilesNotSwept, tilesAround);
    }
  }
  
  function getPositionToSweep() {
    if (game.tilesNotSwept.length < 1) {
      resetRadarSweep();
    }
    return game.tilesNotSwept.pop();
  }
  
  function init(params, bots) {
    // All the possible movement deltas.
    game = params;
    // Just working around the clumsiness of the framework... We want the HP and positions to update here automatically.
    game.you.bots = bots;
    game.avoidMemory = {};
    game.movementTemplate = [];
    for (var i = -game.config.move; i <= game.config.move; i++) for (var j = -game.config.move; j <= game.config.move; j++) {
      var pos = {x: i, y: j};
      if (distance(pos, origo) <= game.config.move && distance(pos, origo) > 0) {
        game.movementTemplate.push(pos);
      }
    }
    game.persistTemplate = [];
    for (var i = -AIParams.persistScanDist; i <= AIParams.persistScanDist; i++) for (var j = -AIParams.persistScanDist; j <= AIParams.persistScanDist; j++) {
      var pos = {x: i, y: j};
      if (distance(pos, origo) <= AIParams.persistScanDist && distance(pos, origo) > 0) {
        game.persistTemplate.push(pos);
      }
    }
    game.avoidanceTemplate = [];
    var avoidanceDistance = AIParams.avoidanceDistance;
    for (var i = -avoidanceDistance; i <= avoidanceDistance; i++) for (var j = -avoidanceDistance; j <= avoidanceDistance; j++) {
      var pos = {x: i, y: j};
      if (distance(pos, origo) <= avoidanceDistance && distance(pos, origo) > 0) {
        game.avoidanceTemplate.push(pos);
      }
    }
    resetRadarSweep();
  }
  
  function notSelf(me) {
    return function(bot) {
      return me.botId != bot.botId;
    }
  }
  
  function teamPositions(me) {
    return game.you.bots.filter(notSelf(me));
  }
  
  function add(a, b) {
    return {
      x: a.x + b.x,
      y: a.y + b.y
    };
  }
  
  function isOnField(coordinate) {
    return betweenPlusMinus(coordinate.x, game.config.fieldRadius) && betweenPlusMinus(coordinate.y, game.config.fieldRadius)
      && distance(origo, coordinate) <= game.config.fieldRadius;
  }
  
  function isMoveOnField(myPos) {
    return function(pos) {
      return isOnField(add(myPos, pos));
    }
  }
  
  function avoidMove(me, avoidCoord) {
    var valuedPositions = _.cloneDeep(game.movementTemplate).filter(isMoveOnField(me)).map(function(pos) {
      // Going through each possible position and minimizing the negative distance to the closest partner.
      return {
        value: -distance(add(me, pos), avoidCoord),
        pos
      };
    });
    valuedPositions = _.sortBy(_.shuffle(valuedPositions), 'value');
    return valuedPositions && add(me, valuedPositions[0].pos);
  }

  function avoidDamage(me, avoidCoord) {
    var valuedPositions = _.cloneDeep(game.avoidanceTemplate).filter(isMoveOnField(me)).map(function(pos) {
      // Going through each possible position and minimizing the negative distance to the position to avoid.
      return {
        value: -distance(add(me, pos), avoidCoord),
        pos
      };
    });
    valuedPositions = _.sortBy(_.shuffle(valuedPositions), 'value');
    return valuedPositions && add(me, valuedPositions[0].pos);
  }
  
  function avoidTeamMembers(me, otherBots) {
    var avoidCoord;
    var minDist;
    otherBots.forEach(function(bot) {
      var dist = distance(me, bot);
      if (!minDist || dist < minDist) {
        minDist = dist;
        avoidCoord = bot;
      }
    });
    // Now we have the nearest team member bot to avoid.
    return avoidMove(me, avoidCoord);
  }
  
  // Max-distance in a hexagonal tiling.
  function distance(a, b) {
    var dx = Math.abs(a.x - b.x);
    var dy = Math.abs(a.y - b.y);
    var dz = Math.abs(a.x + a.y - b.x - b.y);

    return Math.max(dx, dy, dz);
  }
  
  function betweenPlusMinus(value, radius) {
    return (value >= -radius) && (value <= radius)
  }
  
  function getBestMove(from, to) {
    var valuedPositions = _.cloneDeep(game.movementTemplate).filter(isMoveOnField(from))
      .map(function(pos) {
      // Going through each possible position and minimizing the distance to the target.
      return {
        value: distance(add(from, pos), to),
        pos: add(from, pos)
      };
    });
    valuedPositions = _.sortBy(_.shuffle(valuedPositions), 'value');
    return valuedPositions && valuedPositions[0].pos;
  }

  function teamMembersTooClose(bots, bot) {
    var otherBots = bots.filter((other) => other.botId != bot.botId)
      .filter((other) => distance(bot, other) <= 4);
    return otherBots;
  }
  
  function lotsOfPlayers(roundId, events, bots, config) {
    const
      sweep = 'sweep',
      avoidTeam = 'avoidTeam';

    var fireAllPos,
      avoid = {},
      toPersist = {},
      toFire = {};
    var numAliveTeamMembers = bots.filter(function (bot) {
      return bot.alive;
    }).length;

    events.forEach(function(event) {
      switch(event.event) {
      case 'hit':
        console.log('hit: ' + JSON.stringify(event));
        // TODO: If we hit, fire all. If we were hit, escape.
        // TODO: How do "move" events work? Do we get info of enemy movements?
        break;
      case 'radarEcho':
        console.log('radarEcho: ' + JSON.stringify(event));
        toFire[JSON.stringify(event.pos)] = true;
        if (AIParams.persist) {
          toPersist[JSON.stringify(event.pos)] = true;
        }
        break;
      case 'see':
        console.log('see: ' + JSON.stringify(event));
        toFire[JSON.stringify(event.pos)] = true;
        if (AIParams.persist) {
          toPersist[JSON.stringify(event.pos)] = true;
        }
        break;
      case 'detected':
      case 'damaged':
        console.log('detected/damaged: ' + JSON.stringify(event));
        if (AIParams.evade && Math.random() < AIParams.avoidProb) {
          var bot = _.find(bots, (bot) => bot.botId == event.botId);
          var avoidTo = avoidDamage(bot, bot);
          avoid[event.botId] = avoidTo;
          game.avoidMemory[bot.botId] = {
              pos: avoidTo,
              duration: 2
          };
        }
        break;
      default:
        break;
      }
    });
    Object.keys(toPersist).forEach(function(posStr) {
      persist(JSON.parse(posStr), numAliveTeamMembers);
    });
    var scanner;
    var notUnderThreat = bots.filter(function (bot) {
      return bot.alive;
    }).filter((bot) => !avoid[bot.botId]);
    if (notUnderThreat) {
      scanner = notUnderThreat.pop();
    } else {
      scanner = _.shuffle(bots)[0];
    }
    bots.filter(function (bot) {
      return bot.alive;
    }).forEach(function(bot) {
      var action = sweep;
      if (game.avoidMemory[bot.botId]) {
        avoid[bot.botId] = game.avoidMemory[bot.botId].pos;
        game.avoidMemory[bot.botId].duration--;
        if (game.avoidMemory[bot.botId].duration <= 0) {
          game.avoidMemory[bot.botId] = undefined;
        }
      }
      if (Object.keys(toFire).length > 0) {
        fireAllPos = JSON.parse(_.shuffle(Object.keys(toFire))[0]);
      }
      var teamMembersTooCloseList = teamMembersTooClose(bots, bot);
      if (teamMembersTooCloseList.length > 0) {
        action = avoidTeam;
      }
      // The scanner always sweeps.
      if (scanner && (bot.botId == scanner.botId)) {
        var posToSweep = getPositionToSweep();
        console.log("Sweeping " + bot.botId + " at: " + JSON.stringify(posToSweep));
        bot.radar(posToSweep.x, posToSweep.y);
      } else if (avoid[bot.botId] && (!fireAllPos || Math.random() < 0.7)) {
        var targetPos = getBestMove(bot, avoid[bot.botId]);
        bot.move(targetPos.x, targetPos.y);
        console.log("Avoid " + bot.botId + " at: " + JSON.stringify(targetPos));
      } else if (fireAllPos) {
        var firePos = fireAllPos;
        if (AIParams.randomFire) {
          if (Math.random() < 1.0) {
            firePos.x = firePos.x + randInt(-1, 1);
          } else {
            firePos.y = firePos.y + randInt(-1, 1);
          }
          if (Math.random() < 0.4) {
            firePos.x = firePos.x + randInt(-2, 2);
          } else {
            firePos.y = firePos.y + randInt(-2, 2);
          }
          if (!isOnField(firePos)) {
            firePos = fireAllPos;
          }
        }
        bot.cannon(firePos.x, firePos.y);
        console.log("Cannon " + bot.botId + " at: " + JSON.stringify(firePos));
      } else if (action == avoidTeam) {
        var targetPos = avoidTeamMembers(bot, teamMembersTooCloseList);
        if (targetPos) {
          console.log("Moving " + bot.botId + " to: " + JSON.stringify(targetPos));
          bot.move(targetPos.x, targetPos.y);
        }
      } else if (action == sweep) {
        var posToSweep = getPositionToSweep();
        console.log("Sweeping " + bot.botId + " at: " + JSON.stringify(posToSweep));
        bot.radar(posToSweep.x, posToSweep.y);
      }
    });
  }
  
  function twoPlayers(roundId, events, bots, config) {
  }

  function alonePlayer(roundId, events, bots, config) {
    const
      sweep = 'sweep',
      avoidTeam = 'avoidTeam';

    var fireAllPos,
      avoid = {},
      toPersist = {},
      toFire = {},
      first = true;
    var numAliveTeamMembers = 1;

    events.forEach(function(event) {
      switch(event.event) {
      case 'hit':
        console.log('hit: ' + JSON.stringify(event));
        // TODO: If we hit, fire all. If we were hit, escape.
        // TODO: How do "move" events work? Do we get info of enemy movements?
        break;
      case 'radarEcho':
        console.log('radarEcho: ' + JSON.stringify(event));
        toFire[JSON.stringify(event.pos)] = true;
        if (AIParams.persist) {
          toPersist[JSON.stringify(event.pos)] = true;
        }
        break;
      case 'see':
        console.log('see: ' + JSON.stringify(event));
        toFire[JSON.stringify(event.pos)] = true;
        if (AIParams.persist) {
          toPersist[JSON.stringify(event.pos)] = true;
        }
        break;
      case 'detected':
      case 'damaged':
        console.log('detected/damaged: ' + JSON.stringify(event));
        if (AIParams.evade && Math.random() < AIParams.avoidProb) {
          var bot = _.find(bots, (bot) => bot.botId == event.botId);
          var avoidTo = avoidDamage(bot, bot);
          avoid[event.botId] = avoidTo;
          game.avoidMemory[bot.botId] = {
              pos: avoidTo,
              duration: 2
          };
        }
        break;
      default:
        break;
      }
    });
    Object.keys(toPersist).forEach(function(posStr) {
      persist(JSON.parse(posStr), numAliveTeamMembers);
    });
    bots.filter(function (bot) {
      return bot.alive;
    }).forEach(function(bot) {
      var action = sweep;
      if (game.avoidMemory[bot.botId]) {
        avoid[bot.botId] = game.avoidMemory[bot.botId].pos;
        game.avoidMemory[bot.botId].duration--;
        if (game.avoidMemory[bot.botId].duration <= 0) {
          game.avoidMemory[bot.botId] = undefined;
        }
      }
      if (Object.keys(toFire).length > 0) {
        fireAllPos = JSON.parse(_.shuffle(Object.keys(toFire))[0]);
      }
      if (avoid[bot.botId] && !fireAllPos && (Math.random() < 0.5)) {
        var targetPos = getBestMove(bot, avoid[bot.botId]);
        bot.move(targetPos.x, targetPos.y);
        console.log("Avoid " + bot.botId + " at: " + JSON.stringify(targetPos));
      } else if (fireAllPos) {
        var firePos = fireAllPos;
        if (AIParams.randomFire) {
          if (Math.random() < 0.7) {
            firePos.x = firePos.x + randInt(-2, 2);
          } else {
            firePos.y = firePos.y + randInt(-2, 2);
          }
          if (!isOnField(firePos)) {
            firePos = fireAllPos;
          }
        }
        bot.cannon(firePos.x, firePos.y);
        console.log("Cannon " + bot.botId + " at: " + JSON.stringify(firePos));
      } else {
        var posToSweep = getPositionToSweep();
        console.log("Sweeping " + bot.botId + " at: " + JSON.stringify(posToSweep));
        bot.radar(posToSweep.x, posToSweep.y);
      }
    });
  }
  
  function makeDecisions(roundId, events, bots, config) {
    var numAliveTeamMembers = bots.filter(function (bot) {
      return bot.alive;
    }).length;

    if (numAliveTeamMembers > 2) {
      lotsOfPlayers(roundId, events, bots, config);
    } else if (numAliveTeamMembers == 2) {
      lotsOfPlayers(roundId, events, bots, config);
    } else {
      alonePlayer(roundId, events, bots, config);
    }
    _.each(events, function(event) {
      if (event.event === "noaction") {
        console.log("Bot did not respond in required time", event.data);
      }
    });
    console.log(JSON.stringify(AIParams));
  }

  function randInt(min, max) {
    var range = max - min;
    var rand = Math.floor(Math.random() * (range + 1));
    return min + rand;
  }

  return {
    teamName: 'Paradroid',
    botNames: botNames,
    makeDecisions: makeDecisions,
    init: init
  };
};
