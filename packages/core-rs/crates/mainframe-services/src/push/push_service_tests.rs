use super::*;
use serde_json::json;

fn msg(priority: PushPriority) -> PushMessage {
    PushMessage {
        title: "Test".to_string(),
        body: "Test".to_string(),
        data: json!({}),
        priority,
    }
}

#[tokio::test]
async fn registers_a_push_token() {
    let service = PushService::new();
    service.register_device("device-1", "ExponentPushToken[xxx]");
    assert!(service.has_registered_devices());
}

#[tokio::test]
async fn tracks_connected_devices() {
    let service = PushService::new();
    service.register_device("device-1", "ExponentPushToken[xxx]");
    service.set_device_connected("device-1", true);
    assert!(service.is_device_connected("device-1"));

    service.set_device_connected("device-1", false);
    assert!(!service.is_device_connected("device-1"));
}

#[tokio::test]
async fn sends_to_disconnected_devices_only() {
    let service = PushService::new();
    service.register_device("device-1", "ExponentPushToken[aaa]");
    service.register_device("device-2", "ExponentPushToken[bbb]");
    service.set_device_connected("device-1", true);
    service.set_device_connected("device-2", false);

    let messages = service.collect_push_messages(&PushMessage {
        title: "Permission Required".to_string(),
        body: "Claude wants to run: npm test".to_string(),
        data: json!({ "chatId": "chat-1", "type": "permission" }),
        priority: PushPriority::High,
    });
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0].to, "ExponentPushToken[bbb]");
}

#[tokio::test]
async fn skips_push_when_all_devices_connected() {
    let service = PushService::new();
    service.register_device("device-1", "ExponentPushToken[aaa]");
    service.set_device_connected("device-1", true);
    assert!(
        service
            .collect_push_messages(&msg(PushPriority::Default))
            .is_empty()
    );
}

#[tokio::test]
async fn unregisters_a_device() {
    let service = PushService::new();
    service.register_device("device-1", "ExponentPushToken[xxx]");
    assert!(service.has_registered_devices());
    service.unregister_device("device-1");
    assert!(!service.has_registered_devices());
}

#[tokio::test]
async fn skips_push_when_desktop_active() {
    let service = PushService::new();
    service.register_device("device-1", "ExponentPushToken[aaa]");
    service.set_desktop_active(true);
    assert!(
        service
            .collect_push_messages(&msg(PushPriority::Default))
            .is_empty()
    );
    service.dispose();
}

#[tokio::test]
async fn sends_push_when_desktop_idle() {
    let service = PushService::new();
    service.register_device("device-1", "ExponentPushToken[aaa]");
    service.set_desktop_active(true);
    service.set_desktop_active(false);
    assert_eq!(
        service
            .collect_push_messages(&msg(PushPriority::Default))
            .len(),
        1
    );
}

#[tokio::test]
async fn deduplicates_shared_push_tokens() {
    let service = PushService::new();
    service.register_device("device-1", "ExponentPushToken[aaa]");
    service.register_device("device-2", "ExponentPushToken[aaa]");

    let messages = service.collect_push_messages(&msg(PushPriority::Default));
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0].to, "ExponentPushToken[aaa]");
}

#[tokio::test(start_paused = true)]
async fn expires_desktop_active_after_staleness_timeout() {
    let service = PushService::new();
    service.register_device("device-1", "ExponentPushToken[aaa]");
    service.set_desktop_active(true);

    // Let the spawned timer task get polled so it registers its sleep at t0,
    // then advance past the 6-minute staleness timeout and let it run.
    tokio::task::yield_now().await;
    tokio::time::advance(Duration::from_millis(STALENESS_MS + 100)).await;
    for _ in 0..10 {
        if !service
            .collect_push_messages(&msg(PushPriority::Default))
            .is_empty()
        {
            break;
        }
        tokio::task::yield_now().await;
    }

    assert_eq!(
        service
            .collect_push_messages(&msg(PushPriority::Default))
            .len(),
        1
    );
}

#[tokio::test(start_paused = true)]
async fn resets_staleness_timer_on_repeated_set_desktop_active_true() {
    let service = PushService::new();
    service.register_device("device-1", "ExponentPushToken[aaa]");
    service.set_desktop_active(true);
    tokio::task::yield_now().await; // let timer1 register its sleep at t0

    // Advance 5 minutes, then re-report active (resets the timer).
    tokio::time::advance(Duration::from_millis(5 * 60 * 1000)).await;
    service.set_desktop_active(true);
    tokio::task::yield_now().await; // let timer2 register its sleep at t0+5m

    // Advance another 5 minutes (10 total, but only 5 since last active).
    tokio::time::advance(Duration::from_millis(5 * 60 * 1000)).await;
    tokio::task::yield_now().await;

    // Still suppressed — timer was reset.
    assert!(
        service
            .collect_push_messages(&msg(PushPriority::Default))
            .is_empty()
    );
    service.dispose();
}
