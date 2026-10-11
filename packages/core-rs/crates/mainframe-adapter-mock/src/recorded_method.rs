use serde::{Deserialize, Deserializer, Serialize, Serializer};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RecordedMethod {
    OnInit,
    OnMessage,
    OnToolResult,
    OnPermission,
    OnPermissionCancelled,
    OnResult,
    OnExit,
    OnError,
    OnCompact,
    OnCompactStart,
    OnContextUsage,
    OnPlanFile,
    OnSkillFile,
    OnQueuedProcessed,
    OnTodoUpdate,
    OnPrDetected,
    OnCliMessage,
    OnSkillLoaded,
    OnSubagentChild,
    OnTrustRequired,
    OnProviderQuota,
    OnApiRetry,
    OnMessagePartial,
    OnWorkflowRun,
    SendMessage,
    Interrupt,
    Unknown(String),
}
impl RecordedMethod {
    pub fn as_str(&self) -> &str {
        match self {
            Self::OnInit => "onInit",
            Self::OnMessage => "onMessage",
            Self::OnToolResult => "onToolResult",
            Self::OnPermission => "onPermission",
            Self::OnPermissionCancelled => "onPermissionCancelled",
            Self::OnResult => "onResult",
            Self::OnExit => "onExit",
            Self::OnError => "onError",
            Self::OnCompact => "onCompact",
            Self::OnCompactStart => "onCompactStart",
            Self::OnContextUsage => "onContextUsage",
            Self::OnPlanFile => "onPlanFile",
            Self::OnSkillFile => "onSkillFile",
            Self::OnQueuedProcessed => "onQueuedProcessed",
            Self::OnTodoUpdate => "onTodoUpdate",
            Self::OnPrDetected => "onPrDetected",
            Self::OnCliMessage => "onCliMessage",
            Self::OnSkillLoaded => "onSkillLoaded",
            Self::OnSubagentChild => "onSubagentChild",
            Self::OnTrustRequired => "onTrustRequired",
            Self::OnProviderQuota => "onProviderQuota",
            Self::OnApiRetry => "onApiRetry",
            Self::OnMessagePartial => "onMessagePartial",
            Self::OnWorkflowRun => "onWorkflowRun",
            Self::SendMessage => "sendMessage",
            Self::Interrupt => "interrupt",
            Self::Unknown(value) => value,
        }
    }
}
impl From<&str> for RecordedMethod {
    fn from(value: &str) -> Self {
        match value {
            "onInit" => Self::OnInit,
            "onMessage" => Self::OnMessage,
            "onToolResult" => Self::OnToolResult,
            "onPermission" => Self::OnPermission,
            "onPermissionCancelled" => Self::OnPermissionCancelled,
            "onResult" => Self::OnResult,
            "onExit" => Self::OnExit,
            "onError" => Self::OnError,
            "onCompact" => Self::OnCompact,
            "onCompactStart" => Self::OnCompactStart,
            "onContextUsage" => Self::OnContextUsage,
            "onPlanFile" => Self::OnPlanFile,
            "onSkillFile" => Self::OnSkillFile,
            "onQueuedProcessed" => Self::OnQueuedProcessed,
            "onTodoUpdate" => Self::OnTodoUpdate,
            "onPrDetected" => Self::OnPrDetected,
            "onCliMessage" => Self::OnCliMessage,
            "onSkillLoaded" => Self::OnSkillLoaded,
            "onSubagentChild" => Self::OnSubagentChild,
            "onTrustRequired" => Self::OnTrustRequired,
            "onProviderQuota" => Self::OnProviderQuota,
            "onApiRetry" => Self::OnApiRetry,
            "onMessagePartial" => Self::OnMessagePartial,
            "onWorkflowRun" => Self::OnWorkflowRun,
            "sendMessage" => Self::SendMessage,
            "interrupt" => Self::Interrupt,
            value => Self::Unknown(value.to_string()),
        }
    }
}
impl PartialEq<&str> for RecordedMethod {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl std::fmt::Display for RecordedMethod {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}
impl Serialize for RecordedMethod {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.as_str())
    }
}
impl<'de> Deserialize<'de> for RecordedMethod {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Ok(String::deserialize(deserializer)?.as_str().into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn wire_methods_round_trip_including_unknown_extensions() {
        for wire in ["onMessage", "sendMessage", "futureMethod"] {
            let encoded = serde_json::to_string(wire).unwrap();
            let method: RecordedMethod = serde_json::from_str(&encoded).unwrap();
            assert_eq!(serde_json::to_string(&method).unwrap(), encoded);
        }
    }
}
