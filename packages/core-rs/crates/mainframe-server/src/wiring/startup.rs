use std::io;
use tokio::net::TcpListener;

pub(crate) async fn bind_before_database<T>(
    port: u16,
    open_database: impl FnOnce() -> T,
) -> io::Result<(TcpListener, T)> {
    let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port)).await?;
    let database = open_database();
    Ok((listener, database))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    #[tokio::test]
    async fn existing_listener_prevents_database_startup() {
        let old_daemon = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = old_daemon.local_addr().unwrap().port();
        let opened = Cell::new(false);
        let result = bind_before_database(port, || opened.set(true)).await;
        assert_eq!(result.unwrap_err().kind(), io::ErrorKind::AddrInUse);
        assert!(!opened.get());
    }

    #[tokio::test]
    async fn ownership_is_retained_during_and_after_database_startup() {
        let reservation = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = reservation.local_addr().unwrap();
        drop(reservation);
        let (listener, attempted_bind) =
            bind_before_database(address.port(), || std::net::TcpListener::bind(address))
                .await
                .unwrap();
        assert_eq!(attempted_bind.unwrap_err().kind(), io::ErrorKind::AddrInUse);
        let result = TcpListener::bind(listener.local_addr().unwrap()).await;
        assert_eq!(result.unwrap_err().kind(), io::ErrorKind::AddrInUse);
    }
}
