const md5 = require( "parcel-bundler/src/utils/md5" );
const config = require( "parcel-bundler/src/utils/config" );
const fs = require( "parcel-bundler/src/utils/fs" );
const pipeSpawn = require( "parcel-bundler/src/utils/pipeSpawn" );

const command_exists = require( "command-exists" );
const {spawn, exec, execFile} = require( "child-process-promise" );
const Asset = require( "parcel-bundler/src/Asset" );
const path = require( "path" );

const REQUIRED_CARGO_WEB = [0, 6, 2];

class CargoWebAsset extends Asset {
    constructor( name, pkg, options ) {
        super( name, pkg, options );

        this.type = "cargo-web-" + md5( name );

        this.cargo_web_output = null;
        this.scratch_dir = path.join( options.cacheDir, ".cargo-web" );
    }

    static async cargo_web_command() {
        let command = "cargo-web";
        let isFromEnv = false;
        let isInstalled, needsUpgrade;

        if (process.env.CARGO_WEB) {
            command = process.env.CARGO_WEB;
            isFromEnv = true;
        }

        try {
            await command_exists(command);
            const cargo_web_version_output = (await execFile( command, [ "--version" ])).std;
            if (cargo_web_version_output.startsWith("cargo-web ")) {
                isInstalled = true;
                needsUpgrade =
                    !CargoWebAsset.cargo_web_version_is_satisfied(cargo_web_version_output, REQUIRED_CARGO_WEB);
            } else {
                isInstalled = false;
            }
        } catch(_) {
            isInstalled = false;
        }

        return { command: command, isFromEnv: isFromEnv, isInstalled: isInstalled, needsUpgrade: needsUpgrade };
    }

    static cargo_web_version_is_satisfied(cargo_version_output, required_version) {
        return !/(\d+)\.(\d+)\.(\d+)/
            .exec( cargo_version_output )
            .slice(1)
            .map(match => parseInt(match, 10))
            .some((version_fragment, i) => version_fragment < required_version[i]);
    }

    process() {
        if( this.options.isWarmUp ) {
            return;
        }

        return super.process();
    }

    static rustup_is_installed() {
        return new Promise(resolve => {
            command_exists( "rustup" )
                .then(() => resolve(true))
                .catch(() => resolve(false));
        })
    };

    static async install_nightly() {
        const rustup_show = await exec( "rustup show" );
        if( !rustup_show.stdout.includes( "nightly" ) ) {
            await pipeSpawn( "rustup", ["update"] );
            await pipeSpawn( "rustup", ["toolchain", "install", "nightly"] );
        }
    }

    async parse() {
        if ( !await CargoWebAsset.rustup_is_installed() ) {
            throw new Error("Rustup isn't installed. Visit https://rustup.rs/ for more info.");
        }

        await CargoWebAsset.install_nightly();

        const cargo_web = await CargoWebAsset.cargo_web_command();

        if(cargo_web.isFromEnv) {
            if(!cargo_web.isInstalled) {
                throw new Error("The custom cargo-web location defined in CARGO_WEB isn't valid.")
            } else if(cargo_web.needsUpgrade) {
                throw new Error("The custom cargo-web executable defined in CARGO_WEB needs to be manually upgraded");
            }
        } else if(!cargo_web.isInstalled || cargo_web.needsUpgrade) {
            await pipeSpawn( "cargo", [ "install", "-f", "cargo-web" ] );
        }

        const dir = path.dirname( await config.resolve( this.name, ["Cargo.toml"] ) );
        const args = [
            "run",
            "nightly",
            cargo_web.command,
            "build",
            "--target",
            "wasm32-unknown-unknown",
            "--runtime",
            "experimental-only-loader",
            "--message-format",
            "json"
        ];

        const opts = {
            cwd: dir,
            stdio: ["ignore", "pipe", "pipe"]
        };

        const rust_build = spawn( "rustup", args, opts );
        const child = rust_build.childProcess;

        let artifact_wasm = null;
        let artifact_js = null;
        let output = "";
        let stdout = "";
        let stderr = "";

        child.stdout.on( "data", data => {
            stdout += data;
            for( ;; ) {
                const index = stdout.indexOf( "\n" );
                if( index < 0 ) {
                    break;
                }

                const raw_msg = stdout.substr( 0, index );
                stdout = stdout.substr( index + 1 );
                const msg = JSON.parse( raw_msg );

                if( msg.reason === "compiler-artifact" ) {
                    artifact_js = msg.filenames.find(filename => filename.match( /\.js$/ ));
                    artifact_wasm = msg.filenames.find(filename => filename.match( /\.wasm$/ ));
                } else if( msg.reason === "message" ) {
                    output += msg.message.rendered;
                } else if( msg.reason === "cargo-web-paths-to-watch" ) {
                    msg.paths
                        .filter( entry => entry.path !== this.name )
                        .forEach( entry => this.addDependency( entry.path, { includedInParent: true } ) );
                }
            }
        });

        child.stderr.on( "data", (data) => {
            stderr += data;
            for( ;; ) {
                const index = stderr.indexOf( "\n" );
                if( index < 0 ) {
                    break;
                }

                const line = stderr.substr( 0, index );
                stderr = stderr.substr( index + 1 );
                output += line + "\n";
            }
        });

        try {
            await rust_build;

            if( artifact_js === null ) {
                throw new Error( "No .js artifact found! Are you sure your crate is of proper type?" );
            }

            if( artifact_wasm === null ) {
                throw new Error( "No .wasm artifact found! This should never happen!" );
            }

            const loader_body = await fs.readFile( artifact_js );
            const loader_path = path.join( this.scratch_dir, "loader-" + md5( this.name ) + ".js" );
            const loader = `
                module.exports = function( bundle ) {
                    ${loader_body}
                    return fetch( bundle )
                        .then( response => response.arrayBuffer() )
                        .then( bytes => WebAssembly.compile( bytes ) )
                        .then( mod => __initialize( mod, true ) );
                };
            `;

            // HACK: If we don't do this we're going to get
            // "loadedAssets is not iterable" exception from Parcel
            // on the first rebuild.
            //
            // It looks like Parcel really doesn't like it when
            // the files it watches are being modified while it's running.
            const loader_exists = await fs.exists( loader_path );
            if( loader_exists ) {
                setTimeout( () => {
                    fs.writeFile( loader_path, loader );
                }, 10 );
            } else {
                await fs.writeFile( loader_path, loader );
            }

            this.addDependency( loader_path );
            this.artifact_wasm = artifact_wasm;
        } catch(e) {
            this.cargo_web_output = `Compilation failed!\n${output}`;
            throw new Error( `Compilation failed: ${e.message}` );
        }
    }

    collectDependencies() {}

    generate() {
        const generated = {};
        generated[ this.type ] = {
            path: this.artifact_wasm,
            mtime: Date.now()
        };

        return generated;
    }

    generateErrorMessage( err ) {
        if( this.cargo_web_output ) {
            err.message = this.cargo_web_output;
            if( err.message.indexOf( "\x1B" ) >= 0 ) {
                // Prevent everything from being red.
                err.message = err.message.replace( /\n/g, "\n\x1B[0;37m" );
            }

            err.stack = "";
        }

        return err;
    }
}

module.exports = CargoWebAsset;
