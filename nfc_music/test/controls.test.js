'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Controls = require('../lib/controls');

function setup(state) {
    const calls = [];
    const router = {
        volumioGetState: () => state,
        volumioToggle: () => calls.push('toggle'),
        volumioNext: () => calls.push('next'),
        volumioPrevious: () => calls.push('prev'),
        volumioSeek: p => calls.push('seek ' + p),
        volumiosetvolume: v => calls.push('volume ' + v)
    };
    return { controls: new Controls(router, { info() {} }), calls };
}

test('play/pauze, volgende, vorige', async () => {
    const { controls, calls } = setup({});
    await controls.run({ command: 'toggle' });
    await controls.run({ command: 'next' });
    await controls.run({ command: 'prev' });
    assert.deepEqual(calls, ['toggle', 'next', 'prev']);
});

test('vorige gebruikt Volumio zelf, nooit een eigen seek', async () => {
    const { controls, calls } = setup({ status: 'play', seek: 60000 });
    await controls.run({ command: 'prev' });
    assert.deepEqual(calls, ['prev']);
});

test('volume +5 / -5 vanaf de huidige stand', async () => {
    const up = setup({ volume: 40 });
    await up.controls.run({ command: 'volume_up', data: { step: 5 } });
    const down = setup({ volume: 40 });
    await down.controls.run({ command: 'volume_down', data: { step: 5 } });
    assert.deepEqual([up.calls, down.calls], [['volume 45'], ['volume 35']]);
});

test('volume blijft tussen 0 en 100', async () => {
    const high = setup({ volume: 98 });
    await high.controls.run({ command: 'volume_up', data: { step: 5 } });
    const low = setup({ volume: 2 });
    await low.controls.run({ command: 'volume_down', data: { step: 5 } });
    assert.deepEqual([high.calls, low.calls], [['volume 100'], ['volume 0']]);
});

test('standaardwaarden: stap 5, vast volume 20', async () => {
    const step = setup({ volume: 50 });
    await step.controls.run({ command: 'volume_up' });
    const fixed = setup({});
    await fixed.controls.run({ command: 'volume_set' });
    assert.deepEqual([step.calls, fixed.calls], [['volume 55'], ['volume 20']]);
});

test('vast volume 0 blijft 0', async () => {
    const { controls, calls } = setup({});
    await controls.run({ command: 'volume_set', data: { value: 0 } });
    assert.deepEqual(calls, ['volume 0']);
});

test('onbekend commando geeft een fout', async () => {
    const { controls } = setup({});
    await assert.rejects(controls.run({ command: 'stop' }), /Unknown control command/);
});
