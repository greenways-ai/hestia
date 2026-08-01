use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::Duration;

use hara_wasm::resp::{RespConnection, RespValue};

pub struct FabricRespServer {
    host: String,
    port: u16,
    running: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl FabricRespServer {
    pub fn start(host: &str, port: u16, service: crate::FabricService) -> Result<Self, String> {
        let listener = TcpListener::bind((host, port))
            .map_err(|error| format!("RESP bind {host}:{port} failed: {error}"))?;
        let address = listener
            .local_addr()
            .map_err(|error| format!("RESP address failed: {error}"))?;
        listener
            .set_nonblocking(true)
            .map_err(|error| format!("RESP listener setup failed: {error}"))?;
        let running = Arc::new(AtomicBool::new(true));
        let active = running.clone();
        let instance = format!("FABRIC-{}-{}", std::process::id(), address.port());
        let thread = std::thread::Builder::new()
            .name("hara-fabric-listener".into())
            .spawn(move || {
                while active.load(Ordering::Acquire) {
                    match listener.accept() {
                        Ok((stream, _)) => {
                            let service = service.clone();
                            let instance = instance.clone();
                            let _ = std::thread::Builder::new()
                                .name("hara-fabric-client".into())
                                .spawn(move || serve_fabric(stream, service, &instance));
                        }
                        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                            std::thread::sleep(Duration::from_millis(10));
                        }
                        Err(_) => break,
                    }
                }
            })
            .map_err(|error| format!("RESP listener thread failed: {error}"))?;
        Ok(Self {
            host: host.into(),
            port: address.port(),
            running,
            thread: Some(thread),
        })
    }

    pub fn endpoint(&self) -> String {
        format!("{}:{}", self.host, self.port)
    }

    pub fn stop(&mut self) {
        self.running.store(false, Ordering::Release);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

impl Drop for FabricRespServer {
    fn drop(&mut self) {
        self.stop();
    }
}

fn serve_fabric(stream: TcpStream, service: crate::FabricService, instance: &str) {
    let Ok(mut connection) = RespConnection::new(stream) else {
        return;
    };
    let mut space = "default".to_owned();
    let mut session = "ROOT".to_owned();
    loop {
        let request = match connection.read() {
            Ok(Some(RespValue::Array(Some(values)))) => values,
            Ok(Some(_)) => {
                let _ = connection.write(&RespValue::Error("BAD_REQUEST expected array".into()));
                continue;
            }
            Ok(None) => return,
            Err(error) => {
                let _ = connection.write(&RespValue::Error(format!("BAD_REQUEST {error}")));
                continue;
            }
        };
        if request.is_empty() {
            continue;
        }
        let Ok(operation) = fabric_text(&request, 0, "operation") else {
            let _ = connection.write(&RespValue::Error("BAD_REQUEST operation required".into()));
            continue;
        };
        let operation = operation.to_ascii_uppercase();
        if operation == "QUIT" {
            let _ = connection.write(&RespValue::Simple("OK".into()));
            return;
        }
        if operation == "HELLO" {
            let _ = connection.write(&RespValue::array([
                "SERVER",
                "HARA-FABRIC",
                "INSTANCE",
                instance,
                "PROTOCOL",
                "4",
                "SPACE",
                &space,
                "SESSION",
                &session,
            ]));
            continue;
        }
        let id = request
            .get(1)
            .and_then(RespValue::text)
            .unwrap_or_else(|| "?".into());
        let result = fabric_operation(
            &service,
            &mut space,
            &mut session,
            &operation,
            &request[2..],
        );
        match result {
            Ok(values) => {
                let mut frame = vec![RespValue::bulk("RESULT"), RespValue::bulk(&id)];
                frame.extend(values);
                let _ = connection.write(&RespValue::Array(Some(frame)));
                let _ = connection.write(&RespValue::array(["DONE", &id, "OK"]));
            }
            Err(error) => {
                let (code, message) = error
                    .split_once(':')
                    .map_or(("service/error", error.as_str()), |(code, message)| {
                        (code, message.trim())
                    });
                let _ = connection.write(&RespValue::array(["ERROR", &id, code, message]));
                let _ = connection.write(&RespValue::array(["DONE", &id, "ERROR"]));
            }
        }
    }
}

fn fabric_operation(
    service: &crate::FabricService,
    attached_space: &mut String,
    attached_session: &mut String,
    operation: &str,
    arguments: &[RespValue],
) -> Result<Vec<RespValue>, String> {
    match operation {
        "SPACE" => {
            let action = fabric_text(arguments, 0, "SPACE action")?.to_ascii_uppercase();
            match action.as_str() {
                "CREATE" => {
                    let name = fabric_text(arguments, 1, "space name")?;
                    service.create_space(&name)?;
                    Ok(vec![RespValue::bulk(name)])
                }
                "ATTACH" => {
                    let name = fabric_text(arguments, 1, "space name")?;
                    if !service.list_spaces()?.contains(&name) {
                        return Err(format!("space/not-found: {name}"));
                    }
                    *attached_space = name.clone();
                    *attached_session = "ROOT".into();
                    Ok(vec![RespValue::bulk(name)])
                }
                "LIST" => Ok(service
                    .list_spaces()?
                    .into_iter()
                    .map(RespValue::bulk)
                    .collect()),
                "DROP" => {
                    let name = fabric_text(arguments, 1, "space name")?;
                    service.drop_space(&name)?;
                    if *attached_space == name {
                        *attached_space = "default".into();
                        *attached_session = "ROOT".into();
                    }
                    Ok(vec![RespValue::bulk("OK")])
                }
                "INFO" => Ok(vec![
                    RespValue::bulk(attached_space.clone()),
                    RespValue::bulk(attached_session.clone()),
                ]),
                _ => Err(format!("space/action: {action}")),
            }
        }
        "SESSION" => {
            let action = fabric_text(arguments, 0, "SESSION action")?.to_ascii_uppercase();
            match action.as_str() {
                "NEW" => {
                    let name = fabric_text(arguments, 1, "session name")?;
                    service.create_session(attached_space, &name)?;
                    Ok(vec![RespValue::bulk(name)])
                }
                "ATTACH" => {
                    let name = fabric_text(arguments, 1, "session name")?;
                    if !service.list_sessions(attached_space)?.contains(&name) {
                        return Err(format!("session/not-found: {name}"));
                    }
                    *attached_session = name.clone();
                    Ok(vec![RespValue::bulk(name)])
                }
                "DETACH" => {
                    *attached_session = "ROOT".into();
                    Ok(vec![RespValue::bulk("ROOT")])
                }
                "LIST" => Ok(service
                    .list_sessions(attached_space)?
                    .into_iter()
                    .map(RespValue::bulk)
                    .collect()),
                "CLOSE" => {
                    let name = fabric_text(arguments, 1, "session name")?;
                    service.close_session(attached_space, &name)?;
                    if *attached_session == name {
                        *attached_session = "ROOT".into();
                    }
                    Ok(vec![RespValue::bulk("OK")])
                }
                "INFO" => Ok(vec![
                    RespValue::bulk(attached_space.clone()),
                    RespValue::bulk(attached_session.clone()),
                ]),
                _ => Err(format!("session/action: {action}")),
            }
        }
        "EVAL" => Ok(vec![RespValue::bulk(service.eval(
            attached_space,
            attached_session,
            &fabric_text(arguments, 0, "source")?,
        )?)]),
        "MODULE" => {
            let action = fabric_text(arguments, 0, "MODULE action")?.to_ascii_uppercase();
            match action.as_str() {
                "PUT" => {
                    let manifest = fabric_text(arguments, 1, "manifest")?;
                    let module = fabric_bytes(arguments, 2, "module")?;
                    Ok(vec![RespValue::bulk(service.put_module(&manifest, &module)?)])
                }
                "LOAD" => {
                    let digest = fabric_text(arguments, 1, "digest")?;
                    Ok(vec![RespValue::bulk(service.load_module(
                        attached_space,
                        attached_session,
                        &digest,
                    )?)])
                }
                "CALL" => {
                    let qualified = fabric_text(arguments, 1, "namespace/export")?;
                    let args = fabric_bytes(arguments, 2, "HTA1 arguments")?;
                    Ok(vec![RespValue::Bulk(Some(service.invoke_module(
                        attached_space,
                        attached_session,
                        &qualified,
                        &args,
                    )?))])
                }
                _ => Err(format!("module/action: {action}")),
            }
        }
        "REPORT" => {
            let action = fabric_text(arguments, 0, "REPORT action")?.to_ascii_uppercase();
            match action.as_str() {
                "SEND" => {
                    let target = fabric_text(arguments, 1, "target session")?;
                    let signal = fabric_text(arguments, 2, "signal")?;
                    let data = fabric_bytes(arguments, 3, "report data")?;
                    let receipt = service.send_report(
                        attached_space,
                        attached_session,
                        &target,
                        &signal,
                        &data,
                    )?;
                    Ok(vec![
                        RespValue::bulk(receipt.id),
                        RespValue::Integer(receipt.delivered as i64),
                        RespValue::Integer(i64::from(receipt.retained)),
                        receipt
                            .sequence
                            .map_or(RespValue::Bulk(None), |value| RespValue::Integer(value as i64)),
                    ])
                }
                "SUBSCRIBE" => {
                    let signal = fabric_text(arguments, 1, "signal")?;
                    Ok(vec![RespValue::bulk(service.subscribe(
                        attached_space,
                        attached_session,
                        &signal,
                    )?)])
                }
                "UNSUBSCRIBE" => {
                    let id = fabric_text(arguments, 1, "subscription")?;
                    Ok(vec![RespValue::Integer(i64::from(service.unsubscribe(&id)?))])
                }
                "NEXT" => {
                    let id = fabric_text(arguments, 1, "subscription")?;
                    Ok(match service.next_report(&id)? {
                        Some(report) => report_values(report),
                        None => vec![RespValue::Bulk(None)],
                    })
                }
                "RETAIN" => {
                    let signal = fabric_text(arguments, 1, "signal")?;
                    let max_events = fabric_usize(arguments, 2, "max events")?;
                    let max_age_ms = fabric_u64(arguments, 3, "max age ms")?;
                    service.retain(
                        attached_space,
                        attached_session,
                        &signal,
                        max_events,
                        max_age_ms,
                    )?;
                    Ok(vec![RespValue::bulk("OK")])
                }
                "REPLAY" => {
                    let signal = fabric_text(arguments, 1, "signal")?;
                    let after = fabric_u64(arguments, 2, "after sequence")?;
                    let limit = fabric_usize(arguments, 3, "limit")?;
                    Ok(service
                        .replay(attached_space, attached_session, &signal, after, limit)?
                        .into_iter()
                        .map(|report| RespValue::Array(Some(report_values(report))))
                        .collect())
                }
                _ => Err(format!("report/action: {action}")),
            }
        }
        "METRICS" => Ok(vec![RespValue::bulk(service.metrics()?.json())]),
        "EVENTS" => {
            let cursor = fabric_u64(arguments, 0, "cursor")?;
            let limit = fabric_usize(arguments, 1, "limit")?;
            Ok(service
                .events_since(cursor, limit)?
                .into_iter()
                .map(|event| RespValue::bulk(event.json()))
                .collect())
        }
        "TOPOLOGY" => Ok(vec![RespValue::bulk(service.topology_json()?)]),
        "COMMANDS" => Ok(vec![RespValue::bulk(
            "HELLO SPACE SESSION EVAL MODULE REPORT METRICS EVENTS TOPOLOGY COMMANDS QUIT",
        )]),
        _ => Err(format!("protocol/unknown-operation: {operation}")),
    }
}

fn report_values(report: crate::Report) -> Vec<RespValue> {
    vec![
        RespValue::bulk(report.id),
        RespValue::bulk(report.space),
        RespValue::bulk(report.source),
        RespValue::bulk(report.target),
        RespValue::bulk(report.signal),
        RespValue::Bulk(Some(report.data)),
        RespValue::Integer(report.timestamp_ms as i64),
        report
            .sequence
            .map_or(RespValue::Bulk(None), |value| RespValue::Integer(value as i64)),
    ]
}

fn fabric_text(values: &[RespValue], index: usize, label: &str) -> Result<String, String> {
    values
        .get(index)
        .and_then(RespValue::text)
        .ok_or_else(|| format!("protocol/bad-request: {label} required"))
}

fn fabric_bytes(values: &[RespValue], index: usize, label: &str) -> Result<Vec<u8>, String> {
    match values.get(index) {
        Some(RespValue::Bulk(Some(bytes))) => Ok(bytes.clone()),
        Some(RespValue::Simple(value)) => Ok(value.as_bytes().to_vec()),
        _ => Err(format!("protocol/bad-request: {label} required")),
    }
}

fn fabric_u64(values: &[RespValue], index: usize, label: &str) -> Result<u64, String> {
    fabric_text(values, index, label)?
        .parse()
        .map_err(|_| format!("protocol/bad-request: {label} must be an unsigned integer"))
}

fn fabric_usize(values: &[RespValue], index: usize, label: &str) -> Result<usize, String> {
    fabric_text(values, index, label)?
        .parse()
        .map_err(|_| format!("protocol/bad-request: {label} must be an unsigned integer"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ServiceConfig;

    #[test]
    fn protocol_manages_spaces_reports_and_redacted_analytics() {
        let service = crate::FabricService::start(ServiceConfig { shards: 2, ..ServiceConfig::default() }).unwrap();
        let mut server = FabricRespServer::start("127.0.0.1", 0, service).unwrap();
        let mut connection = RespConnection::new(TcpStream::connect(server.endpoint()).unwrap()).unwrap();
        connection.write(&RespValue::array(["HELLO", "4"])).unwrap();
        assert!(matches!(connection.read().unwrap().unwrap(), RespValue::Array(Some(_))));
        let command = |connection: &mut RespConnection, values: &[&str]| {
            connection.write(&RespValue::array(values.iter().copied())).unwrap();
            let result = connection.read().unwrap().unwrap();
            assert!(matches!(connection.read().unwrap().unwrap(), RespValue::Array(Some(_))));
            result
        };
        command(&mut connection, &["SPACE", "1", "CREATE", "workroom"]);
        command(&mut connection, &["SPACE", "2", "ATTACH", "workroom"]);
        command(&mut connection, &["SESSION", "3", "NEW", "researcher"]);
        command(&mut connection, &["SESSION", "4", "NEW", "reviewer"]);
        command(&mut connection, &["SESSION", "5", "ATTACH", "reviewer"]);
        let RespValue::Array(Some(values)) = command(&mut connection, &["REPORT", "6", "SUBSCRIBE", "finding"]) else { panic!("subscribe result") };
        let subscription = values[2].text().unwrap();
        command(&mut connection, &["SESSION", "7", "ATTACH", "researcher"]);
        connection.write(&RespValue::Array(Some(vec![
            RespValue::bulk("REPORT"), RespValue::bulk("8"), RespValue::bulk("SEND"),
            RespValue::bulk("reviewer"), RespValue::bulk("finding"),
            RespValue::Bulk(Some(vec![0, 1, 2, 255])),
        ]))).unwrap();
        let _ = connection.read().unwrap().unwrap();
        let _ = connection.read().unwrap().unwrap();
        let RespValue::Array(Some(values)) = command(&mut connection, &["REPORT", "9", "NEXT", &subscription]) else { panic!("report result") };
        assert_eq!(values[7], RespValue::Bulk(Some(vec![0, 1, 2, 255])));
        let RespValue::Array(Some(values)) = command(&mut connection, &["METRICS", "10"]) else { panic!("metrics result") };
        assert!(values[2].text().unwrap().contains("\"reports_accepted\":1"));
        server.stop();
    }
}
