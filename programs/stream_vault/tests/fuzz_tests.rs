#[cfg(test)]
mod fuzz_tests {
    use proptest::prelude::*;
    fn calculate_available_amount_safe(
        total_amount: u64,
        withdrawn_amount: u64,
        start_time: i64,
        end_time: i64,
        current_time: i64,
        total_paused_duration: i64,
    ) -> Result<u64, &'static str> {
        if end_time <= start_time {
            return Ok(0);
        }
        if current_time < start_time {
            return Ok(0);
        }
        if withdrawn_amount >= total_amount {
            return Ok(0);
        }
        let duration = (end_time - start_time) as u64;
        let effective_current = if current_time > end_time {
            end_time
        } else {
            current_time
        };
        let elapsed = (effective_current - start_time).saturating_sub(total_paused_duration).max(0) as u64;
        let available = if duration > 0 {
            let rate = total_amount / duration;
            let streamed = rate.saturating_mul(elapsed).min(total_amount);
            streamed.saturating_sub(withdrawn_amount)
        } else {
            0
        };
        Ok(available)
    }
    proptest! {
        #[test]
        fn test_release_rate_no_overflow(
            total_amount in 1u64..=u64::MAX,
            start_time in 0i64..=i64::MAX/2,
            duration in 1i64..=365*24*60*60i64, 
        ) {
            let end_time = start_time.saturating_add(duration);
            let result = calculate_available_amount_safe(
                total_amount,
                0, 
                start_time,
                end_time,
                start_time + duration/2, 
                0, 
            );
            prop_assert!(result.is_ok());
            if let Ok(available) = result {
                prop_assert!(available <= total_amount);
            }
        }
    }
    proptest! {
        #[test]
        fn test_withdrawal_accounting_invariant(
            total_amount in 1000u64..=1_000_000_000u64,
            withdrawn_percent in 0f64..=1f64,  
            start_time in 0i64..=1_000_000i64,
            duration in 60i64..=365*24*60*60i64,
            elapsed_percent in 0f64..=1f64,
            pause_duration in 0i64..=365*24*60*60i64,
        ) {
            let end_time = start_time + duration;
            let current_time = start_time + ((duration as f64 * elapsed_percent) as i64);
            let withdrawn_amount = ((total_amount as f64) * withdrawn_percent) as u64;
            let result = calculate_available_amount_safe(
                total_amount,
                withdrawn_amount,
                start_time,
                end_time,
                current_time,
                pause_duration,
            );
            if let Ok(available) = result {
                prop_assert!(
                    withdrawn_amount.saturating_add(available) <= total_amount,
                    "Invariant violated: withdrawn({}) + available({}) > total({})",
                    withdrawn_amount,
                    available,
                    total_amount
                );
            }
        }
    }
    proptest! {
        #[test]
        fn test_pause_reduces_available(
            total_amount in 1000u64..=1_000_000_000u64,
            start_time in 0i64..=1_000_000i64,
            duration in 3600i64..=30*24*60*60i64, 
            current_offset in 0i64..=30*24*60*60i64,
            pause_duration1 in 0i64..=3600i64,
            pause_duration2 in 0i64..=3600i64,
        ) {
            let end_time = start_time + duration;
            let current_time = start_time + current_offset.min(duration);
            let available_less_pause = calculate_available_amount_safe(
                total_amount,
                0,
                start_time,
                end_time,
                current_time,
                pause_duration1,
            );
            let available_more_pause = calculate_available_amount_safe(
                total_amount,
                0,
                start_time,
                end_time,
                current_time,
                pause_duration1 + pause_duration2,
            );
            if let (Ok(less_pause), Ok(more_pause)) = (available_less_pause, available_more_pause) {
                prop_assert!(
                    more_pause <= less_pause,
                    "Pause invariant violated: more_pause({}) > less_pause({})",
                    more_pause,
                    less_pause
                );
            }
        }
    }
    proptest! {
        #[test]
        fn test_time_monotonicity(
            total_amount in 1000u64..=1_000_000_000u64,
            start_time in 0i64..=1_000_000i64,
            duration in 3600i64..=365*24*60*60i64,
            time1_percent in 0f64..=0.9f64,
            time2_percent in 0.1f64..=1f64,
        ) {
            prop_assume!(time2_percent > time1_percent);
            let end_time = start_time + duration;
            let time1 = start_time + ((duration as f64 * time1_percent) as i64);
            let time2 = start_time + ((duration as f64 * time2_percent) as i64);
            let available1 = calculate_available_amount_safe(
                total_amount,
                0,
                start_time,
                end_time,
                time1,
                0,
            );
            let available2 = calculate_available_amount_safe(
                total_amount,
                0,
                start_time,
                end_time,
                time2,
                0,
            );
            if let (Ok(amt1), Ok(amt2)) = (available1, available2) {
                prop_assert!(
                    amt2 >= amt1,
                    "Time monotonicity violated: amt2({}) < amt1({}) at times {} and {}",
                    amt2,
                    amt1,
                    time1,
                    time2
                );
            }
        }
    }
    proptest! {
        #[test]
        fn test_boundary_conditions(
            use_zero_amount in prop::bool::ANY,
            use_max_amount in prop::bool::ANY,
            use_equal_times in prop::bool::ANY,
            use_negative_duration in prop::bool::ANY,
        ) {
            let total_amount = if use_zero_amount {
                0u64
            } else if use_max_amount {
                u64::MAX
            } else {
                1_000_000u64
            };
            let (start_time, end_time) = if use_equal_times {
                (1000i64, 1000i64)
            } else if use_negative_duration {
                (2000i64, 1000i64)
            } else {
                (1000i64, 2000i64)
            };
            let result = calculate_available_amount_safe(
                total_amount,
                0,
                start_time,
                end_time,
                start_time + 500,
                0,
            );
            if use_zero_amount || use_equal_times || use_negative_duration {
                if let Ok(amt) = result {
                    prop_assert!(amt == 0 || total_amount == 0);
                }
            }
        }
    }
    proptest! {
        #[test]
        fn test_withdrawal_determinism(
            total_amount in 1000u64..=1_000_000_000u64,
            withdrawn in 0u64..=500_000_000u64,
            start_time in 0i64..=1_000_000i64,
            duration in 1000i64..=1_000_000i64,
            current_offset in 0i64..=1_000_000i64,
            pause_duration in 0i64..=10_000i64,
        ) {
            let end_time = start_time + duration;
            let current_time = start_time + current_offset.min(duration);
            let result1 = calculate_available_amount_safe(
                total_amount,
                withdrawn,
                start_time,
                end_time,
                current_time,
                pause_duration,
            );
            let result2 = calculate_available_amount_safe(
                total_amount,
                withdrawn,
                start_time,
                end_time,
                current_time,
                pause_duration,
            );
            prop_assert_eq!(result1, result2, "Non-deterministic behavior detected");
        }
    }
}