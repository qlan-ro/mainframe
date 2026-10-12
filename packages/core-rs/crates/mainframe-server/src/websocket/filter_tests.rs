use super::*;

#[test]
fn recorded_event_delivery_matches_the_baseline_for_each_connection() {
    let records: Vec<serde_json::Value> =
        serde_json::from_str(include_str!("recorded_events.json")).unwrap();
    let clients = Arc::new(DashMap::new());
    let mut receivers = Vec::new();
    for (id, subscriptions) in [
        ("none", vec![]),
        ("a", vec!["a"]),
        ("b", vec!["b"]),
        ("both", vec!["a", "b"]),
    ] {
        let (tx, rx) = mpsc::unbounded_channel();
        clients.insert(
            id.into(),
            ClientHandle {
                tx,
                subscriptions: Arc::new(Mutex::new(
                    subscriptions.into_iter().map(str::to_owned).collect(),
                )),
            },
        );
        receivers.push(rx);
    }
    for record in &records {
        let event: DaemonEvent = serde_json::from_value(record.clone()).unwrap();
        fanout(&clients, &event);
    }
    let expected = [
        vec![0, 4, 5, 6, 7, 10],
        vec![0, 1, 3, 4, 5, 6, 7, 8, 10],
        vec![0, 2, 4, 5, 6, 7, 9, 10, 11],
        (0..12).collect(),
    ];
    for (mut receiver, indices) in receivers.into_iter().zip(expected) {
        let mut actual = Vec::new();
        while let Ok(payload) = receiver.try_recv() {
            actual.push(serde_json::from_str::<serde_json::Value>(&payload).unwrap());
        }
        let wanted: Vec<_> = indices
            .into_iter()
            .map(|index| records[index].clone())
            .collect();
        assert_eq!(actual, wanted);
    }
}
