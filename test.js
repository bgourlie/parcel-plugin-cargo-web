import test from 'ava';
import mock_require from 'mock-require';
// import CargoWebAsset from './CargoWebAsset';

// test("rustup_is_installed() returns false when the 'rustup' command doesn't exist.", async t => {
//     // const mock_require = require("mock-require");
//     const CargoWebAsset = require ('./CargoWebAsset');
//
//     mock_require('command-exists', function() {
//         return Promise.reject("");
//     } );
//
//     const rustup_is_installed = await CargoWebAsset.rustup_is_installed();
//     t.is(rustup_is_installed, false);
// });

test("rustup_is_installed() returns true when the 'rustup' command exists.", async t => {

    const CargoWebAsset = require ('./CargoWebAsset');
    mock_require('command-exists', (cmd) => Promise.reject(""));

    const rustup_is_installed = await CargoWebAsset.rustup_is_installed();
    t.is(rustup_is_installed, true);
});

