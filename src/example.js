// The Wyvern Rider, used as the first monster in a fresh library and as the test fixture.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.StatblockExample = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function wyvernRider() {
    const base = {
      usage: { type: 'none', recharge: 5, perDay: 1, text: '' },
      reach: 5, rangeNormal: 80, rangeLong: 320,
      extraDamage: [],
      save: { enabled: false, ability: 'Constitution', dc: 13, damage: null, half: true },
      condition: { enabled: false, name: 'Poisoned', duration: '' },
      rider: '', area: '', success: 'half', successText: '', description: '',
    };
    return {
      id: 'm-wyvern-rider',
      name: 'Wyvern Rider',
      meta: { size: 'Large', type: 'Monstrosity', cr: '7' },
      multiattack: {
        enabled: true,
        subject: '',
        counts: { 'a-bite': 1, 'a-sting': 1, 'a-halberd': 1 },
        tail: '',
      },
      actions: [
        {
          ...base, id: 'a-bite', name: 'Bite', kind: 'melee', toHit: 10, reach: 5,
          damage: { count: 2, die: 8, mod: 4, type: 'Piercing' },
        },
        {
          ...base, id: 'a-sting', name: 'Sting', kind: 'melee', toHit: 8, reach: 10,
          damage: { count: 2, die: 6, mod: 4, type: 'Piercing' },
          save: { enabled: true, ability: 'Constitution', dc: 16, damage: { count: 7, die: 6, mod: 0, type: 'Poison' }, half: true },
          condition: { enabled: true, name: 'Poisoned', duration: 'until the start of the wyvern’s next turn' },
          rider: 'if they failed by 5 or more',
        },
        {
          ...base, id: 'a-halberd', name: 'Halberd', kind: 'melee', toHit: 9, reach: 10,
          damage: { count: 2, die: 10, mod: 8, type: 'Slashing' },
        },
      ],
    };
  }

  return { wyvernRider };
});
