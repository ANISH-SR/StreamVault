use super::{AccelerationType, ExponentialStreamingStrategy, StreamingStrategy};
pub fn create_strategy_examples() {
    let linear = ExponentialStreamingStrategy::new(AccelerationType::Linear);
    let quadratic = ExponentialStreamingStrategy::new(AccelerationType::Quadratic);
    let cubic = ExponentialStreamingStrategy::new(AccelerationType::Cubic);
}
pub fn select_strategy_for_project(project_type: &str) -> ExponentialStreamingStrategy {
    match project_type {
        "standard" => {
            ExponentialStreamingStrategy::new(AccelerationType::Linear)
        },
        "milestone-based" => {
            ExponentialStreamingStrategy::new(AccelerationType::Quadratic)
        },
        "completion-critical" => {
            ExponentialStreamingStrategy::new(AccelerationType::Cubic)
        },
        _ => {
            ExponentialStreamingStrategy::default()
        }
    }
}
pub fn compare_payment_at_midpoint() {
    let total_amount = 1000u64;
    let start_time = 0i64;
    let end_time = 100i64;
    let midpoint = 50i64;
    let strategies = [
        ("Linear", ExponentialStreamingStrategy::new(AccelerationType::Linear)),
        ("Quadratic", ExponentialStreamingStrategy::new(AccelerationType::Quadratic)),
        ("Cubic", ExponentialStreamingStrategy::new(AccelerationType::Cubic)),
    ];
    for (name, strategy) in strategies.iter() {
        let earned = strategy.calculate_earned_amount(
            total_amount,
            start_time,
            end_time,
            midpoint,
            0, 
            false,
            None,
        ).unwrap();
        let percentage = (earned as f64 / total_amount as f64) * 100.0;
        println!("{}: {}% earned at midpoint", name, percentage);
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn test_acceleration_type_values() {
        assert_eq!(AccelerationType::Linear as u8, 1);
        assert_eq!(AccelerationType::Quadratic as u8, 2);
        assert_eq!(AccelerationType::Cubic as u8, 3);
        assert_eq!(AccelerationType::Linear.to_factor(), 1.0);
        assert_eq!(AccelerationType::Quadratic.to_factor(), 2.0);
        assert_eq!(AccelerationType::Cubic.to_factor(), 3.0);
    }
}