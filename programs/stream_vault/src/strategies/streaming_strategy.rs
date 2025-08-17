use anchor_lang::prelude::*;
#[derive(AnchorSerialize, AnchorDeserialize, Debug, Clone, Copy, PartialEq, Eq)]
pub enum AccelerationType {
    Linear = 1,
    Quadratic = 2,
    Cubic = 3,
}
impl AccelerationType {
    pub fn to_factor(&self) -> f64 {
        match self {
            AccelerationType::Linear => 1.0,
            AccelerationType::Quadratic => 2.0,
            AccelerationType::Cubic => 3.0,
        }
    }
    pub fn description(&self) -> &str {
        match self {
            AccelerationType::Linear => "Linear: Constant rate over time",
            AccelerationType::Quadratic => "Quadratic: Slow start, accelerating finish",
            AccelerationType::Cubic => "Cubic: Very slow start, rapid acceleration at the end",
        }
    }
}
pub trait StreamingStrategy {
    fn calculate_earned_amount(
        &self,
        total_amount: u64,
        start_time: i64,
        end_time: i64,
        current_time: i64,
        total_paused_duration: i64,
        is_paused: bool,
        pause_time: Option<i64>,
    ) -> Result<u64>;
    fn calculate_release_rate(
        &self,
        total_amount: u64,
        start_time: i64,
        end_time: i64,
    ) -> Result<u64>;
    fn description(&self) -> &str;
}
#[derive(Debug, Clone)]
pub struct StreamingContext {
    pub total_amount: u64,
    pub start_time: i64,
    pub end_time: i64,
    pub current_time: i64,
    pub total_paused_duration: i64,
    pub is_paused: bool,
    pub pause_time: Option<i64>,
    pub withdrawn_amount: u64,
}
impl StreamingContext {
    pub fn new(
        total_amount: u64,
        start_time: i64,
        end_time: i64,
        current_time: i64,
        total_paused_duration: i64,
        is_paused: bool,
        pause_time: Option<i64>,
        withdrawn_amount: u64,
    ) -> Self {
        Self {
            total_amount,
            start_time,
            end_time,
            current_time,
            total_paused_duration,
            is_paused,
            pause_time,
            withdrawn_amount,
        }
    }
    pub fn effective_current_time(&self) -> i64 {
        if self.is_paused {
            self.pause_time.unwrap_or(self.current_time)
        } else {
            self.current_time
        }
    }
    pub fn effective_end_time(&self) -> i64 {
        self.end_time + self.total_paused_duration
    }
}