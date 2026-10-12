use super::*;

pub(super) fn validate_step_ids(
    definition: &AutomationDefinition,
    errors: &mut Vec<ValidationError>,
) {
    let mut seen = BTreeSet::new();
    let mut duplicated = BTreeSet::new();
    for_each_step(&definition.steps, &mut |step| {
        let id = step.id();
        if id.trim().is_empty() {
            errors.push(ValidationError {
                step_id: Some(id.to_string()),
                level: ValidationLevel::Error,
                message: "Every step needs an id.".to_string(),
            });
            return;
        }
        if !seen.insert(id.to_string()) {
            duplicated.insert(id.to_string());
        }
        // The charset is load-bearing beyond display, now: the marker scheme
        // (`@c`, `@w`, `@a`) and the `#`-suffix chain both assume a step id
        // never carries those characters itself.
        if !is_valid_step_id(id) {
            errors.push(ValidationError {
                step_id: Some(id.to_string()),
                level: ValidationLevel::Error,
                message: "Step ids can only use letters, numbers, underscores, and hyphens."
                    .to_string(),
            });
        }
    });
    for id in &duplicated {
        errors.push(ValidationError {
            step_id: Some(id.clone()),
            level: ValidationLevel::Error,
            message: format!("Two steps share the id \"{id}\" — step ids must be unique."),
        });
    }
}
