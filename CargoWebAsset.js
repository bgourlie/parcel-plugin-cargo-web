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

    cargo_web_command() {
        return process.env.CARGO_WEB || "cargo-web";
    }

    process() {
        if( this.options.isWarmUp ) {
            return;
        }

        return super.process();
    }

    static async check_for_rustup() {
        try {
            await command_exists( "rustup" );
        } catch( err ) {
            throw new Error(
                "Rustup isn't installed. Visit https://rustup.rs/ for more info."
            );
        }
    }

    static async install_nightly() {
        const rustup_show = await exec( "rustup show" );
        if( !rustup_show.stdout.includes( "nightly" ) ) {
            await pipeSpawn( "rustup", ["update"] );
            await pipeSpawn( "rustup", ["toolchain", "install", "nightly"] );
        }
    }

    async install_cargo_web() {
        let install_required;
        try {
            const cargo_web_version = await execFile( this.cargo_web_command(), [ "--version" ]);
            install_required = /(\d+)\.(\d+)\.(\d+)/
                .exec( cargo_web_version.stdout )
                .slice(1)
                .map(match => parseInt(match, 10))
                .some((version_fragment, i) => version_fragment < REQUIRED_CARGO_WEB[i]);
        } catch(_) {
            install_required = true;
        }

        if ( install_required ) {
            await pipeSpawn( "cargo", [ "install", "-f", "cargo-web" ] );
        }
    }

    async parse() {
        await CargoWebAsset.check_for_rustup();
        await CargoWebAsset.install_nightly();
        await this.install_cargo_web();

        const dir = path.dirname( await config.resolve( this.name, ["Cargo.toml"] ) );
        const args = [
            "run",
            "nightly",
            this.cargo_web_command(),
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
