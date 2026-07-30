use std::env;
use std::path::PathBuf;

use gw_fabric::resp::FabricRespServer;
use gw_fabric::{FabricService, ServiceConfig};

struct Options {
    host: String,
    port: u16,
    data_dir: Option<PathBuf>,
    shards: Option<usize>,
    node_id: String,
    peers: Vec<String>,
    cluster_epoch: String,
}

fn main() {
    let options = parse_options().unwrap_or_else(|error| {
        eprintln!("gw-fabric: {error}");
        std::process::exit(2);
    });
    run(options).unwrap_or_else(|error| {
        eprintln!("gw-fabric: {error}");
        std::process::exit(1);
    });
}

fn parse_options() -> Result<Options, String> {
    let mut options = Options {
        host: "127.0.0.1".into(),
        port: 1311,
        data_dir: None,
        shards: None,
        node_id: "local".into(),
        peers: Vec::new(),
        cluster_epoch: "local.v1".into(),
    };
    let mut args = env::args().skip(1);
    while let Some(argument) = args.next() {
        let mut value = || args.next().ok_or_else(|| format!("{argument} requires a value"));
        match argument.as_str() {
            "--host" => options.host = value()?,
            "--port" => options.port = value()?.parse().map_err(|_| "--port must be between 0 and 65535".to_owned())?,
            "--data" => options.data_dir = Some(PathBuf::from(value()?)),
            "--shards" => options.shards = Some(value()?.parse().map_err(|_| "--shards must be a positive integer".to_owned())?),
            "--node-id" => options.node_id = value()?,
            "--peer" => options.peers.push(value()?),
            "--cluster-epoch" => options.cluster_epoch = value()?,
            "--version" | "-V" => {
                println!("gw-fabric {}", env!("CARGO_PKG_VERSION"));
                std::process::exit(0);
            }
            "--help" | "-h" => {
                usage();
                std::process::exit(0);
            }
            _ => return Err(format!("unknown option: {argument}")),
        }
    }
    if options.shards == Some(0) {
        return Err("--shards must be a positive integer".into());
    }
    Ok(options)
}

fn run(options: Options) -> Result<(), String> {
    let service = FabricService::start(ServiceConfig {
        shards: options.shards.unwrap_or_else(|| std::thread::available_parallelism().map(usize::from).unwrap_or(1)),
        data_dir: options.data_dir,
        node_id: options.node_id.clone(),
        peers: options.peers,
        cluster_epoch: options.cluster_epoch,
        ..ServiceConfig::default()
    })?;
    let server = FabricRespServer::start(&options.host, options.port, service)?;
    println!("GW FABRIC {} · node {} · space default · session ROOT", server.endpoint(), options.node_id);
    loop { std::thread::park(); }
}

fn usage() {
    println!("gw-fabric [--host HOST] [--port PORT] [--data PATH] [--shards N]");
    println!("          [--node-id NAME] [--peer NAME]... [--cluster-epoch NAME]");
}
