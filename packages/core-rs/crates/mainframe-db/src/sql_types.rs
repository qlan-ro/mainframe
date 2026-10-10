use rusqlite::{
    Connection, Params, Row,
    types::{FromSql, FromSqlError, FromSqlResult, ToSql, ToSqlOutput, Value, ValueRef},
};
use serde::{Serialize, de::DeserializeOwned};

pub trait FromRow: Sized {
    type Error: From<rusqlite::Error>;
    fn from_row(row: &Row<'_>) -> Result<Self, Self::Error>;
}

pub fn query_all<T: FromRow>(
    db: &Connection,
    sql: &str,
    params: impl Params,
) -> Result<Vec<T>, T::Error> {
    let mut statement = db.prepare(sql)?;
    let mut rows = statement.query(params)?;
    let mut values = Vec::new();
    while let Some(row) = rows.next()? {
        values.push(T::from_row(row)?);
    }
    Ok(values)
}

pub fn query_opt<T: FromRow>(
    db: &Connection,
    sql: &str,
    params: impl Params,
) -> Result<Option<T>, T::Error> {
    let mut statement = db.prepare(sql)?;
    let mut rows = statement.query(params)?;
    rows.next()?.map(T::from_row).transpose()
}

pub struct SqlEnum<T>(pub T);
pub struct JsonCol<T>(pub T);
pub struct SqlBool(pub bool);

impl<T: DeserializeOwned> SqlEnum<T> {
    pub fn parse(value: String) -> Result<T, serde_json::Error> {
        serde_json::from_value(serde_json::Value::String(value))
    }

    /// Parses a stored enum string, logging the raw value and returning
    /// `fallback` when it is not a known variant. NULL and `''` read as
    /// `fallback` silently.
    pub fn or_default(value: Option<String>, fallback: T) -> T {
        let Some(raw) = value.filter(|value| !value.is_empty()) else {
            return fallback;
        };
        match Self::parse(raw.clone()) {
            Ok(value) => value,
            Err(error) => {
                tracing::warn!(raw, %error, "invalid persisted enum; using default");
                fallback
            }
        }
    }
}

impl<T: DeserializeOwned> JsonCol<T> {
    /// Parses a stored JSON column, logging the raw value and returning
    /// `fallback` when it is malformed. NULL and `''` read as `fallback`
    /// silently.
    pub fn or_default(value: Option<String>, fallback: T) -> T {
        let Some(raw) = value.filter(|value| !value.is_empty()) else {
            return fallback;
        };
        match serde_json::from_str(&raw) {
            Ok(value) => value,
            Err(error) => {
                tracing::warn!(raw, %error, "invalid persisted JSON; using default");
                fallback
            }
        }
    }
}

impl<T: DeserializeOwned> FromSql for SqlEnum<T> {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        Self::parse(value.as_str()?.to_owned())
            .map(Self)
            .map_err(|error| FromSqlError::Other(Box::new(error)))
    }
}

impl<T: DeserializeOwned> FromSql for JsonCol<T> {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        serde_json::from_str(value.as_str()?)
            .map(Self)
            .map_err(|error| FromSqlError::Other(Box::new(error)))
    }
}

impl FromSql for SqlBool {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        Ok(Self(value.as_i64()? != 0))
    }
}

impl ToSql for SqlBool {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        Ok(ToSqlOutput::Owned(Value::Integer(i64::from(self.0))))
    }
}

impl<T: Serialize> ToSql for JsonCol<T> {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        serde_json::to_string(&self.0)
            .map(|value| ToSqlOutput::Owned(Value::Text(value)))
            .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))
    }
}

impl<T: Serialize> ToSql for SqlEnum<T> {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        crate::enum_to_db_string(&self.0)
            .map(|value| ToSqlOutput::Owned(Value::Text(value)))
            .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))
    }
}
