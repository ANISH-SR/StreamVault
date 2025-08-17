use anchor_lang::prelude::*;
use crate::errors::StreamVaultError;
use super::streaming_strategy::{StreamingStrategy, StreamingContext};
pub struct LinearStreamingStrategy;
impl LinearStreamingStrategy {
    pub fn new() -> Self {
        Self
    }
}
impl StreamingStrategy for LinearStreamingStrategy {
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
        let earned = (total_amount as u128)
            .checked_mul(elapsed as u128)
            .ok_or(error!(StreamVaultError::MathOverflow))?
            .checked_div(total_duration as u128)
            .ok_or(error!(StreamVaultError::MathOverflow))?;
        Ok(earned.min(total_amount as u128) as u64)
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
        let rate = total_amount
            .checked_div(duration as u64)
            .ok_or(error!(StreamVaultError::MathOverflow))?;
        Ok(rate)
    }
    fn description(&self) -> &str {
        "Linear streaming: Funds are released proportionally over time"
    }
}
impl LinearStreamingStrategy {
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
    #[test]
    fn test_linear_interpolation() {
        let strategy = LinearStreamingStrategy::new();
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
        assert_eq!(earned, 500);
        let earned = strategy.calculate_earned_amount(
            total_amount,
            start_time,
            end_time,
            25, 
            0,  
            false, 
            None,  
        ).unwrap();
        assert_eq!(earned, 250);
    }
    #[test]
    fn test_with_pause() {
        let strategy = LinearStreamingStrategy::new();
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
        assert_eq!(earned, 500);
    }
}