use super::*;
use serde_json::json;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

fn msg(priority: PushPriority) -> PushMessage {
    PushMessage {
        title: "Test".to_string(),
        body: "Test".to_string(),
        data: json!({}),
        priority,
    }
}

fn recipients(service: &PushService) -> Vec<String> {
    let mut to: Vec<String> = service
        .collect_push_messages(&msg(PushPriority::Default))
        .into_iter()
        .map(|m| m.to)
        .collect();
    to.sort();
    to
}

#[tokio::test]
async fn sends_to_every_registered_device() {
    let service = PushService::new();
    service.register_device("device-1", "ExponentPushToken[aaa]");
    service.register_device("device-2", "ExponentPushToken[bbb]");
    assert_eq!(
        recipients(&service),
        ["ExponentPushToken[aaa]", "ExponentPushToken[bbb]"]
    );
}

#[tokio::test]
async fn re_registering_a_device_replaces_its_token() {
    let service = PushService::new();
    service.register_device("device-1", "ExponentPushToken[old]");
    service.register_device("device-1", "ExponentPushToken[new]");
    assert_eq!(recipients(&service), ["ExponentPushToken[new]"]);
}

#[tokio::test]
async fn unregisters_a_device() {
    let service = PushService::new();
    service.register_device("device-1", "ExponentPushToken[xxx]");
    service.unregister_device("device-1");
    assert!(recipients(&service).is_empty());
}

#[tokio::test]
async fn deduplicates_shared_push_tokens() {
    let service = PushService::new();
    service.register_device("device-1", "ExponentPushToken[aaa]");
    service.register_device("device-2", "ExponentPushToken[aaa]");
    assert_eq!(recipients(&service), ["ExponentPushToken[aaa]"]);
}

#[tokio::test]
async fn only_high_priority_pushes_play_a_sound() {
    let service = PushService::new();
    service.register_device("device-1", "ExponentPushToken[aaa]");
    let high = service.collect_push_messages(&msg(PushPriority::High));
    let default = service.collect_push_messages(&msg(PushPriority::Default));
    assert_eq!(high[0].sound, Some("default"));
    assert_eq!(default[0].sound, None);
}

#[tokio::test]
async fn skips_push_when_desktop_active() {
    let service = PushService::new();
    service.register_device("device-1", "ExponentPushToken[aaa]");
    service.set_desktop_active(true);
    assert!(recipients(&service).is_empty());
}

#[tokio::test]
async fn sends_push_when_desktop_idle() {
    let service = PushService::new();
    service.register_device("device-1", "ExponentPushToken[aaa]");
    service.set_desktop_active(true);
    service.set_desktop_active(false);
    assert_eq!(recipients(&service).len(), 1);
}

#[tokio::test(start_paused = true)]
async fn expires_desktop_active_after_staleness_timeout() {
    let service = PushService::new();
    service.register_device("device-1", "ExponentPushToken[aaa]");
    service.set_desktop_active(true);

    // Let the spawned timer task get polled so it registers its sleep at t0,
    // then advance past the staleness timeout and let it run.
    tokio::task::yield_now().await;
    tokio::time::advance(STALENESS + Duration::from_millis(100)).await;
    for _ in 0..10 {
        if !recipients(&service).is_empty() {
            break;
        }
        tokio::task::yield_now().await;
    }

    assert_eq!(recipients(&service).len(), 1);
}

#[tokio::test(start_paused = true)]
async fn resets_staleness_timer_on_repeated_set_desktop_active_true() {
    let service = PushService::new();
    service.register_device("device-1", "ExponentPushToken[aaa]");
    service.set_desktop_active(true);
    tokio::task::yield_now().await; // let timer1 register its sleep at t0

    // Advance 5 minutes, then re-report active (resets the timer).
    tokio::time::advance(Duration::from_secs(5 * 60)).await;
    service.set_desktop_active(true);
    tokio::task::yield_now().await; // let timer2 register its sleep at t0+5m

    // Advance another 5 minutes (10 total, but only 5 since last active).
    tokio::time::advance(Duration::from_secs(5 * 60)).await;
    tokio::task::yield_now().await;

    assert!(recipients(&service).is_empty(), "timer was reset");
}

/// Read one HTTP request and return its JSON body.
async fn read_request(stream: &mut tokio::net::TcpStream) -> serde_json::Value {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 4096];
    loop {
        let n = stream.read(&mut chunk).await.unwrap();
        assert!(n > 0, "client closed before the body arrived");
        buf.extend_from_slice(&chunk[..n]);
        let text = String::from_utf8_lossy(&buf);
        let Some(header_end) = text.find("\r\n\r\n") else {
            continue;
        };
        let length: usize = text[..header_end]
            .lines()
            .find_map(|line| {
                let (name, value) = line.split_once(':')?;
                name.eq_ignore_ascii_case("content-length")
                    .then(|| value.trim().parse().unwrap())
            })
            .unwrap();
        let body = &buf[header_end + 4..];
        if body.len() >= length {
            return serde_json::from_slice(&body[..length]).unwrap();
        }
    }
}

/// An Expo stand-in answering one batch: tokens in `dead` get a
/// `DeviceNotRegistered` ticket, every other token an ok ticket.
async fn expo_stub(dead: &'static [&'static str]) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/", listener.local_addr().unwrap());
    tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let request = read_request(&mut stream).await;
        let tickets: Vec<serde_json::Value> = request
            .as_array()
            .unwrap()
            .iter()
            .map(|message| {
                if dead.contains(&message["to"].as_str().unwrap()) {
                    json!({
                        "status": "error",
                        "message": "not a registered push token",
                        "details": { "error": "DeviceNotRegistered" }
                    })
                } else {
                    json!({ "status": "ok", "id": "ticket" })
                }
            })
            .collect();
        let body = json!({ "data": tickets }).to_string();
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        stream.write_all(response.as_bytes()).await.unwrap();
    });
    url
}

#[tokio::test]
async fn drops_a_token_expo_reports_as_no_longer_registered() {
    let url = expo_stub(&["ExponentPushToken[dead]"]).await;
    let service = PushService::with_url(url);
    service.register_device("phone", "ExponentPushToken[live]");
    service.register_device("old-phone", "ExponentPushToken[dead]");

    service.send_push(msg(PushPriority::Default)).await;

    assert_eq!(recipients(&service), ["ExponentPushToken[live]"]);
}

#[tokio::test]
async fn keeps_every_token_when_expo_accepts_the_batch() {
    let url = expo_stub(&[]).await;
    let service = PushService::with_url(url);
    service.register_device("phone", "ExponentPushToken[a]");
    service.register_device("tablet", "ExponentPushToken[b]");

    service.send_push(msg(PushPriority::Default)).await;

    assert_eq!(recipients(&service).len(), 2);
}

#[tokio::test(start_paused = true)]
async fn a_stalled_expo_request_gives_up_at_the_deadline() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/", listener.local_addr().unwrap());
    // Accept and hold the connection without ever answering.
    let holder = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        std::future::pending::<()>().await;
        drop(stream);
    });
    let service = PushService::with_url(url);
    service.register_device("phone", "ExponentPushToken[a]");

    let sent = tokio::time::timeout(
        SEND_TIMEOUT + Duration::from_secs(5),
        service.send_push(msg(PushPriority::Default)),
    )
    .await;

    assert!(
        sent.is_ok(),
        "send_push must return once its deadline passes"
    );
    holder.abort();
}
