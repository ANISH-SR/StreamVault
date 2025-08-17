use anchor_lang::prelude::*;
use crate::errors::StreamVaultError;
use super::streaming_strategy::{StreamingStrategy, StreamingContext, AccelerationType};
pub struct ExponentialStreamingStrategy {
    acceleration_type: AccelerationType,
}
impl ExponentialStreamingStrategy {
    pub fn new(acceleration_type: AccelerationType) -> Self {
        Self {
            acceleration_type,
        }
    }
    pub fn with_factor(factor: f64) -> Self {
        let acceleration_type = if factor <= 1.5 {
            AccelerationType::Linear
        } else if factor <= 2.5 {
            AccelerationType::Quadratic
        } else {
            AccelerationType::Cubic
        };
        Self::new(acceleration_type)
    }
    pub fn default() -> Self {
        Self::new(AccelerationType::Quadratic)
    }
    fn get_factor(&self) -> f64 {
        self.acceleration_type.to_factor()
    }
}
impl StreamingStrategy for ExponentialStreamingStrategy {
    fn calculate_earned_amount(
        &self,
        total_amount: u64,
        start_time: i64,
        end_time: i64,
        current_time: i64,
        total_paused_duration: i64,
        is_paused: bool,
        pause_time: Option<i64>,
    ) -> Result<u64> {
        if current_time < start_time {
            return Ok(0);
        }
        let effective_current_time = if is_paused {
            pause_time.unwrap_or(current_time)
        } else {
            current_time
        };
        let effective_start = start_time;
        let effective_end = end_time + total_paused_duration;
        if effective_current_time >= effective_end {
            return Ok(total_amount);
        }
        let elapsed = effective_current_time
            .checked_sub(effective_start)
            .ok_or(error!(StreamVaultError::MathOverflow))?
            .checked_sub(total_paused_duration)
            .ok_or(error!(StreamVaultError::MathOverflow))?;
        let total_duration = end_time
            .checked_sub(start_time)
            .ok_or(error!(StreamVaultError::MathOverflow))?;
        if total_duration == 0 {
            return Ok(total_amount);
        }
        let time_ratio = elapsed as f64 / total_duration as f64;
        let exponential_ratio = time_ratio.powf(self.get_factor());
        let earned = (total_amount as f64 * exponential_ratio) as u64;
        Ok(earned.min(total_amount))
    }
    fn calculate_release_rate(
        &self,
        total_amount: u64,
        start_time: i64,
        end_time: i64,
    ) -> Result<u64> {
        let duration = end_time
            .checked_sub(start_time)
            .ok_or(error!(StreamVaultError::MathOverflow))?;
        if duration == 0 {
            return Err(error!(StreamVaultError::InvalidTimeRange));
        }
        let avg_rate = total_amount
            .checked_div(duration as u64)
            .ok_or(error!(StreamVaultError::MathOverflow))?;
        let adjusted_rate = (avg_rate as f64 * self.get_factor()) as u64;
        Ok(adjusted_rate)
    }
    fn description(&self) -> &str {
        "Exponential streaming: Funds are released with accelerating rate over time"
    }
}
impl ExponentialStreamingStrategy {
    pub fn calculate_withdrawable_amount(&self, ctx: &StreamingContext) -> Result<u64> {
        let earned = self.calculate_earned_amount(
            ctx.total_amount,
            ctx.start_time,
            ctx.end_time,
            ctx.current_time,
            ctx.total_paused_duration,
            ctx.is_paused,
            ctx.pause_time,
        )?;
        earned
            .checked_sub(ctx.withdrawn_amount)
            .ok_or_else(|| error!(StreamVaultError::MathOverflow))
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::strategies::LinearStreamingStrategy;
    #[test]
    fn test_exponential_interpolation_quadratic() {
        let strategy = ExponentialStreamingStrategy::new(AccelerationType::Quadratic);
        let total_amount = 1000u64;
        let start_time = 0i64;
        let end_time = 100i64;
        let earned = strategy.calculate_earned_amount(
            total_amount,
            start_time,
            end_time,
            50, 
            0,  
            false, 
            None,  
        ).unwrap();
        assert_eq!(earned, 250);
        let earned = strategy.calculate_earned_amount(
            total_amount,
            start_time,
            end_time,
            70, 
            0,  
            false, 
            None,  
        ).unwrap();
        assert!(earned == 489 || earned == 490);
    }
    #[test]
    fn test_exponential_interpolation_cubic() {
        let strategy = ExponentialStreamingStrategy::new(AccelerationType::Cubic);
        let total_amount = 1000u64;
        let start_time = 0i64;
        let end_time = 100i64;
        let earned = strategy.calculate_earned_amount(
            total_amount,
            start_time,
            end_time,
            50, 
            0,  
            false, 
            None,  
        ).unwrap();
        assert_eq!(earned, 125);
        let earned = strategy.calculate_earned_amount(
            total_amount,
            start_time,
            end_time,
            80, 
            0,  
            false, 
            None,  
        ).unwrap();
        assert_eq!(earned, 512);
    }
    #[test]
    fn test_exponential_with_pause() {
        let strategy = ExponentialStreamingStrategy::new(AccelerationType::Quadratic);
        let total_amount = 1000u64;
        let start_time = 0i64;
        let end_time = 100i64;
        let earned = strategy.calculate_earned_amount(
            total_amount,
            start_time,
            end_time,
            60, 
            10, 
            false, 
            None,  
        ).unwrap();
        assert_eq!(earned, 250);
    }
    #[test]
    fn test_exponential_vs_linear() {
        let linear = LinearStreamingStrategy::new();
        let exponential = ExponentialStreamingStrategy::new(AccelerationType::Quadratic);
        let total_amount = 1000u64;
        let start_time = 0i64;
        let end_time = 100i64;
        let linear_earned_early = linear.calculate_earned_amount(
            total_amount, start_time, end_time, 25, 0, false, None
        ).unwrap();
        let exponential_earned_early = exponential.calculate_earned_amount(
            total_amount, start_time, end_time, 25, 0, false, None
        ).unwrap();
        assert_eq!(linear_earned_early, 250);
        assert_eq!(exponential_earned_early, 62);
        let linear_earned_late = linear.calculate_earned_amount(
            total_amount, start_time, end_time, 75, 0, false, None
        ).unwrap();
        let exponential_earned_late = exponential.calculate_earned_amount(
            total_amount, start_time, end_time, 75, 0, false, None
        ).unwrap();
        assert_eq!(linear_earned_late, 750);
        assert_eq!(exponential_earned_late, 562);
        assert!(exponential_earned_early < linear_earned_early);
        assert!(exponential_earned_late < linear_earned_late);
    }
    #[test]
    fn test_acceleration_type_enum() {
        let linear_strategy = ExponentialStreamingStrategy::new(AccelerationType::Linear);
        let quadratic_strategy = ExponentialStreamingStrategy::new(AccelerationType::Quadratic);
        let cubic_strategy = ExponentialStreamingStrategy::new(AccelerationType::Cubic);
        let total_amount = 1000u64;
        let start_time = 0i64;
        let end_time = 100i64;
        let current_time = 50i64; 
        let linear_earned = linear_strategy.calculate_earned_amount(
            total_amount, start_time, end_time, current_time, 0, false, None
        ).unwrap();
        let quadratic_earned = quadratic_strategy.calculate_earned_amount(
            total_amount, start_time, end_time, current_time, 0, false, None
        ).unwrap();
        let cubic_earned = cubic_strategy.calculate_earned_amount(
            total_amount, start_time, end_time, current_time, 0, false, None
        ).unwrap();
        assert_eq!(linear_earned, 500);
        assert_eq!(quadratic_earned, 250);
        assert_eq!(cubic_earned, 125);
        assert!(cubic_earned < quadratic_earned);
        assert!(quadratic_earned < linear_earned);
    }
    #[test]
    fn test_with_factor_constructor() {
        let linear = ExponentialStreamingStrategy::with_factor(1.0);
        let also_linear = ExponentialStreamingStrategy::with_factor(1.5);
        let quadratic = ExponentialStreamingStrategy::with_factor(2.0);
        let also_quadratic = ExponentialStreamingStrategy::with_factor(2.5);
        let cubic = ExponentialStreamingStrategy::with_factor(3.0);
        let also_cubic = ExponentialStreamingStrategy::with_factor(10.0);
        assert_eq!(linear.get_factor(), 1.0);
        assert_eq!(also_linear.get_factor(), 1.0);
        assert_eq!(quadratic.get_factor(), 2.0);
        assert_eq!(also_quadratic.get_factor(), 2.0);
        assert_eq!(cubic.get_factor(), 3.0);
        assert_eq!(also_cubic.get_factor(), 3.0);
    }
}