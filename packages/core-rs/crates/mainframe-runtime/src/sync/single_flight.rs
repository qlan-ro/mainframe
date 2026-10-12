use super::LockExt;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::sync::watch;

type Flights = Arc<Mutex<HashMap<String, watch::Sender<bool>>>>;

#[derive(Clone, Default)]
pub struct SingleFlight(Flights);

impl SingleFlight {
    pub fn claim(&self, key: &str) -> Result<FlightClaim, FlightWaiter> {
        let mut flights = self.0.lock_recover();
        if let Some(existing) = flights.get(key) {
            return Err(FlightWaiter(existing.subscribe()));
        }
        let (done, _) = watch::channel(false);
        flights.insert(key.to_string(), done.clone());
        Ok(FlightClaim {
            flights: self.0.clone(),
            key: key.to_string(),
            done,
        })
    }

    pub fn get(&self, key: &str) -> Option<FlightWaiter> {
        self.0
            .lock_recover()
            .get(key)
            .map(|done| FlightWaiter(done.subscribe()))
    }

    pub fn contains_key(&self, key: &str) -> bool {
        self.0.lock_recover().contains_key(key)
    }

    pub fn is_empty(&self) -> bool {
        self.0.lock_recover().is_empty()
    }
}

/// Dropping the owner completes this generation even when its task is aborted.
#[derive(Debug)]
pub struct FlightClaim {
    flights: Flights,
    key: String,
    done: watch::Sender<bool>,
}

impl Drop for FlightClaim {
    fn drop(&mut self) {
        let mut flights = self.flights.lock_recover();
        flights.remove(&self.key);
        self.done.send_replace(true);
    }
}

/// Each waiter observes its own generation; completion survives late polling.
#[derive(Debug)]
pub struct FlightWaiter(watch::Receiver<bool>);

impl FlightWaiter {
    pub async fn wait(mut self) {
        while !*self.0.borrow_and_update() {
            if self.0.changed().await.is_err() {
                break;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[tokio::test]
    async fn join_flight_returns_when_slot_already_completed() {
        let flights = SingleFlight::default();
        let owner = flights.claim("c1").unwrap();
        let waiter = flights.claim("c1").unwrap_err();
        drop(owner);
        let next = flights.claim("c1").unwrap();
        tokio::time::timeout(Duration::from_secs(1), waiter.wait())
            .await
            .unwrap();
        assert!(flights.contains_key("c1"));
        drop(next);
        assert!(flights.is_empty());
    }

    #[tokio::test]
    async fn join_flight_wakes_when_owner_completes_after_registration() {
        let flights = SingleFlight::default();
        let owner = flights.claim("c1").unwrap();
        let waiter = tokio::spawn(flights.claim("c1").unwrap_err().wait());
        tokio::task::yield_now().await;
        assert!(!waiter.is_finished());
        drop(owner);
        tokio::time::timeout(Duration::from_secs(1), waiter)
            .await
            .unwrap()
            .unwrap();
        assert!(flights.is_empty());
    }

    #[tokio::test]
    async fn cancelling_owner_releases_waiters_and_allows_retry() {
        let flights = SingleFlight::default();
        let owner = flights.claim("key").unwrap();
        let waiter = flights.claim("key").unwrap_err();
        let task = tokio::spawn(async move {
            let _owner = owner;
            std::future::pending::<()>().await;
        });
        task.abort();
        assert!(task.await.unwrap_err().is_cancelled());
        tokio::time::timeout(Duration::from_secs(1), waiter.wait())
            .await
            .unwrap();
        assert!(flights.claim("key").is_ok());
    }
}
