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
 *  * Vector location of a team mate: (name<own_name)/2 + distance
 * - Distance > radius*2 is safe, distance <= radius to avoid. Need to have range to scan the whole game area.
 */

module.exports = function Ai() {
  var game = {};
  const origo = {x: 0, y: 0};

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
    var tileRadius = Math.floor(game.config.fieldRadius / game.config.radar);
    game.tilesNotSwept = [];
    var r = game.config.radar;
    var center = {
      x: randInt(-game.config.radar, game.config.radar),
      y: randInt(-game.config.radar, game.config.radar)
    };
    for (var i = -tileRadius - 1; i <= tileRadius + 1; i++) for (var j = -tileRadius - 1; j <= tileRadius + 1; j++) {
      var tileCenter = {
          x: (r+1)*i-r*j + center.x,
          y: r*i+(2*r+1)*j + center.y
      };
      if (distance(origo, tileCenter) < game.config.fieldRadius - (r - 1)) {
        game.tilesNotSwept.push(tileCenter);
      }
    }
    game.tilesNotSwept = _.shuffle(game.tilesNotSwept);
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
    game.movementTemplate = [];
    for (var i = -game.config.move; i <= game.config.move; i++) for (var j = -game.config.move; j <= game.config.move; j++) {
      var pos = {x: i, y: j};
      if (distance(pos, origo) <= game.config.move && distance(pos, origo) > 0) {
        game.movementTemplate.push(pos);
      }
    }
    resetRadarSweep();
  }
  
  function dotProduct(a, b) {
    return a.x*b.x+a.y*b.y;
  }
  
  function delta(a, b) {
    var tieBreaker = a.botId && b.botId && (a.botId > b.botId) * Math.random() || 0;
    return {x: b.x - a.x + tieBreaker, y: b.y - a.y + tieBreaker};
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
  
  function length(v) {
    return Math.sqrt(v.x*v.x+v.y*v.y);
  }  
  function normalize(v) {
    var scale = length(v);
    return {
      x: v.x / scale,
      y: v.y / scale
    };
  }
  
  function isOnField(coordinate) {
    return betweenPlusMinus(coordinate.x, game.config.fieldRadius) && betweenPlusMinus(coordinate.y, game.config.fieldRadius);
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
  
  function avoidTeamMembers(me) {
    var otherBots = teamPositions(me);
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

  function makeDecisions(roundId, events, bots, config) {
    const
      sweep = 'sweep',
      avoidTeam = 'avoidTeam';

    var fireAllPos,
      avoid = {};
    
    events.forEach(function(event) {
      switch(event.event) {
      case 'hit':
        console.log('hit: ' + JSON.stringify(event));
        // TODO: If we hit, fire all. If we were hit, escape.
        // TODO: How do "move" events work? Do we get info of enemy movements?
        break;
      case 'radarEcho':
        console.log('radarEcho: ' + JSON.stringify(event));
        fireAllPos = event.pos;
        break;
      case 'see':
        console.log('see: ' + JSON.stringify(event));
        fireAllPos = event.pos;
        break;
      case 'detected':
      case 'damaged':
        console.log('detected/damaged: ' + JSON.stringify(event));
        avoid[event.botId] = true;
        break;
      default:
        break;
      }
    });
    
    bots.forEach(function(bot) {
      var action = sweep;
      if (Math.random() > 0.7) {
        action = avoidTeam;
      }
      if (avoid[bot.botId]) {
        var targetPos = avoidMove(bot, bot);
        bot.move(targetPos.x, targetPos.y);
        console.log("Avoid " + bot.botId + " at: " + JSON.stringify(targetPos));
      } else if (fireAllPos) {
        bot.cannon(fireAllPos.x, fireAllPos.y);
        console.log("Cannon " + bot.botId + " at: " + JSON.stringify(fireAllPos));
      } else if (action == avoidTeam) {
        var targetPos = avoidTeamMembers(bot);
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

    _.each(events, function(event) {
      if (event.event === "noaction") {
        console.log("Bot did not respond in required time", event.data);
      }
    });
  }

  function randInt(min, max) {
    var range = max - min;
    var rand = Math.floor(Math.random() * (range + 1));
    return min + rand;
  }

  return {
    // The AI must return these three attributes
    botNames: botNames,
    makeDecisions: makeDecisions,
    init: init
  };
};
