//! Ask-me form fields (contract §1): five field types, `showWhen` visibility.
//! Canonical definitions live in `mainframe-types::automation` (the
//! interaction summary WS payload carries them); re-exported here under the
//! engine's local names.

pub use mainframe_types::automation::{
    AutomationFormField, AutomationFormFieldType as FormFieldType, AutomationShowWhen as ShowWhen,
};
