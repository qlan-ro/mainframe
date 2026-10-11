//! `format_status_report`/`format_devices` render the exact text `mainframe
//! status` prints; expectations are hardcoded, not recomputed from the
//! functions under test.

use serde_json::json;

use super::*;

mod format_status_report_tests {
    use super::*;

    #[test]
    fn renders_the_health_block_from_a_full_health_payload() {
        let health = json!({ "status": "ok", "version": "2.3.1", "tunnelUrl": "https://foo.trycloudflare.com" });
        assert_eq!(
            format_status_report(&health, 31415, "/home/user/.mainframe"),
            "\n  Mainframe Daemon\n  Status:     ok\n  Version:    2.3.1\n  Port:       31415\n  Tunnel:     https://foo.trycloudflare.com\n  Data dir:   /home/user/.mainframe"
        );
    }

    #[test]
    fn falls_back_to_placeholders_for_missing_fields() {
        assert_eq!(
            format_status_report(&json!({}), 31415, "/home/user/.mainframe"),
            "\n  Mainframe Daemon\n  Status:     ?\n  Version:    unknown\n  Port:       31415\n  Tunnel:     not active\n  Data dir:   /home/user/.mainframe"
        );
    }
}

mod format_devices_tests {
    use super::*;

    #[test]
    fn reports_none_for_an_empty_device_list() {
        assert_eq!(format_devices(&[]), "\n  Paired devices: none");
    }

    #[test]
    fn lists_each_paired_device_with_its_id_and_last_seen() {
        let devices = vec![
            json!({ "deviceName": "Doru's iPhone", "deviceId": "dev-1", "lastSeen": "2026-07-20T10:00:00Z" }),
            json!({ "deviceName": "iPad", "deviceId": "dev-2", "lastSeen": "2026-07-21T08:30:00Z" }),
        ];
        assert_eq!(
            format_devices(&devices),
            "\n  Paired devices:\n    - Doru's iPhone (dev-1) — last seen: 2026-07-20T10:00:00Z\n    - iPad (dev-2) — last seen: 2026-07-21T08:30:00Z"
        );
    }

    #[test]
    fn falls_back_to_placeholders_for_missing_device_fields() {
        assert_eq!(
            format_devices(&[json!({})]),
            "\n  Paired devices:\n    - ? (?) — last seen: never"
        );
    }
}
