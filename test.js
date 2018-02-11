import test from 'ava';
import mock_require from 'mock-require';

test("rustup_is_installed() returns false when the 'rustup' command doesn't exist.", async t => {
    mock_require('command-exists', (cmd) => Promise.reject(new Error()));
    const CargoWebAsset = mock_require.reRequire('./CargoWebAsset');
    const rustup_is_installed = await CargoWebAsset.rustup_is_installed();
    t.is(rustup_is_installed, false);
});

test("rustup_is_installed() returns true when the 'rustup' command exists.", async t => {
    mock_require('command-exists', cmd => Promise.resolve(cmd));
    const CargoWebAsset = mock_require.reRequire('./CargoWebAsset');
    const rustup_is_installed = await CargoWebAsset.rustup_is_installed();
    t.is(rustup_is_installed, true);
});

test("cargo_web_command() favors CARGO_WEB environment variable if set", async t => {
    process.env.CARGO_WEB = "/some/other/cargo-web";
    mock_require("child-process-promise", {execFile: () => Promise.resolve({std: "cargo-web 0.1.2"})});
    const CargoWebAsset = mock_require.reRequire("./CargoWebAsset");
    const cargo_web = await CargoWebAsset.cargo_web_command();
    t.is(cargo_web.command, "/some/other/cargo-web");
});

test("cargo_web_command() defaults to 'cargo-web' if CARGO WEB isn't set", async t => {
    process.env.CARGO_WEB = "";
    const CargoWebAsset = require("./CargoWebAsset");
    const cargo_web = await CargoWebAsset.cargo_web_command();
    t.is(cargo_web.command, "cargo-web");
});

test("cargo_web_command returns {isFromEnv: true, isInstalled: false} when custom cargo-web command isn't cargo-web", async t => {
    process.env.CARGO_WEB = "not-cargo-web";
    mock_require("command-exists", () => Promise.reject(new Error()));
    const CargoWebAsset = mock_require.reRequire("./CargoWebAsset");
    const cargo_web = await CargoWebAsset.cargo_web_command();
    t.is(cargo_web.isFromEnv, true);
    t.is(cargo_web.isInstalled, false);
});

test("cargo_web_command returns {isFromEnv: true, isInstalled: false} when custom cargo-web command doesn't exist", async t => {
    process.env.CARGO_WEB = "not-cargo-web";
    mock_require("command-exists", () => Promise.reject(new Error()));
    const CargoWebAsset = mock_require.reRequire("./CargoWebAsset");
    const cargo_web = await CargoWebAsset.cargo_web_command();
    t.is(cargo_web.isFromEnv, true);
    t.is(cargo_web.isInstalled, false);
});

test("cargo_web_command returns {isInstalled: true, needsUpgrade: true} when cargo-web doesn't satisfy required version", async t => {
    mock_require("command-exists", () => Promise.resolve(true));
    mock_require("child-process-promise", {execFile: () => Promise.resolve({std: "cargo-web version.is.mocked"})});
    const CargoWebAsset = mock_require.reRequire("./CargoWebAsset");
    CargoWebAsset.cargo_web_version_is_satisfied = () => false;

    const cargo_web = await CargoWebAsset.cargo_web_command();
    t.is(cargo_web.isInstalled, true);
    t.is(cargo_web.needsUpgrade, true);
});

test("cargo_web_command returns {isInstalled: true, needsUpgrade: false} when cargo-web command is valid", async t => {
    mock_require("command-exists", () => Promise.resolve(true));
    mock_require("child-process-promise", {execFile: () => Promise.resolve({std: "cargo-web version.is.mocked"})});
    const CargoWebAsset = mock_require.reRequire("./CargoWebAsset");
    CargoWebAsset.cargo_web_version_is_satisfied = () => true;

    const cargo_web = await CargoWebAsset.cargo_web_command();
    t.is(cargo_web.isInstalled, true);
    t.is(cargo_web.needsUpgrade, false);
});

test("cargo_web_version_is_satisfied returns true with exact match", async t => {
    const CargoWebAsset = mock_require.reRequire("./CargoWebAsset");
    const result = CargoWebAsset.cargo_web_version_is_satisfied("cargo-web 0.6.3", [0, 6, 3]);
    t.is(result, true);
});

test("cargo_web_version_is_satisfied returns true and ignores minor/patch when major > required major", async t => {
    const CargoWebAsset = mock_require.reRequire("./CargoWebAsset");
    const result = CargoWebAsset.cargo_web_version_is_satisfied("cargo-web 1.5.2", [0, 6, 3]);
    t.is(result, true);
});

test("cargo_web_version_is_satisfied returns false when patch is less", async t => {
    const CargoWebAsset = mock_require.reRequire("./CargoWebAsset");
    const result = CargoWebAsset.cargo_web_version_is_satisfied("cargo-web 0.6.2", [0, 6, 3]);
    t.is(result, false);
});

test("cargo_web_version_is_satisfied returns false when minor version is less", async t => {
    const CargoWebAsset = mock_require.reRequire("./CargoWebAsset");
    const result = CargoWebAsset.cargo_web_version_is_satisfied("cargo-web 0.5.3", [0, 6, 3]);
    t.is(result, false);
});

test("cargo_web_version_is_satisfied returns false when major version is less", async t => {
    const CargoWebAsset = mock_require.reRequire("./CargoWebAsset");
    const result = CargoWebAsset.cargo_web_version_is_satisfied("cargo-web 0.6.3", [1, 6, 3]);
    t.is(result, false);
});

function new_cargo_web_asset(CargoWebAsset) {
    return new CargoWebAsset("", "", {rootDir: "", cacheDir: ""});
}