use anchor_lang::prelude::*;
use crate::strategies::{ExponentialStreamingStrategy, StreamingStrategy, StreamingContext, AccelerationType};
#[account]
pub struct Stream {
    pub employer: Pubkey,
    pub freelancer: Pubkey,
    pub stream_id: u64,
    pub start_time: i64,
    pub end_time: i64,
    pub total_amount: u64,
    pub withdrawn_amount: u64,
    pub is_paused: bool,
    pub pause_time: Option<i64>,
    pub total_paused_duration: i64,
    pub pause_resume_count: u8,
    pub last_operation_slot: u64,
    pub accumulated_dust: u64,
    pub mint: Pubkey,
    pub vault: Pubkey,
    pub acceleration_type: AccelerationType,
    pub bump: u8,
    pub is_funded: bool,
}
impl Stream {
    pub const LEN: usize = 8 + 
        32 + 
        32 + 
        8 + 
        8 + 
        8 + 
        8 + 
        8 + 
        1 + 
        1 + 8 + 
        8 + 
        1 + 
        8 + 
        8 + 
        32 + 
        32 + 
        1 + 
        1;

    pub const LEN_CALCULATION: usize = 8 + 
        32 + 32 + 8 + 1 + 1 + 8 + 8 + 1 + 8 + 8 + 32 + 32 + 1 + 1;

    pub fn calculate_earned_amount(&self, current_time: i64) -> Result<u64> {
        let strategy = ExponentialStreamingStrategy::new(self.acceleration_type);
        strategy.calculate_earned_amount(
            self.total_amount,
            self.start_time,
            self.end_time,
            current_time,
            self.total_paused_duration,
            self.is_paused,
            self.pause_time,
        )
    }
    pub fn calculate_withdrawable_amount(&self, current_time: i64) -> Result<u64> {
        let ctx = StreamingContext::new(
            self.total_amount,
            self.start_time,
            self.end_time,
            current_time,
            self.total_paused_duration,
            self.is_paused,
            self.pause_time,
            self.withdrawn_amount,
        );
        let strategy = ExponentialStreamingStrategy::new(self.acceleration_type);
        strategy.calculate_withdrawable_amount(&ctx)
    }
    pub fn is_ended(&self, current_time: i64) -> bool {
        current_time >= self.end_time + self.total_paused_duration
    }
    pub fn get_stream_duration(&self) -> Result<i64> {
        self.end_time
            .checked_sub(self.start_time)
            .ok_or(error!(crate::errors::SprintVaultError::MathOverflow))
    }
    pub fn should_auto_close(&self, current_time: i64) -> Result<bool> {
        if !self.is_paused {
            return Ok(false);
        }
        if let Some(pause_time) = self.pause_time {
            let current_pause_duration = current_time
                .checked_sub(pause_time)
                .ok_or(error!(crate::errors::StreamVaultError::MathOverflow))?;
            let sprint_duration = self.get_sprint_duration()?;
            if current_pause_duration > sprint_duration {
                return Ok(true);
            }
        }
        Ok(false)
    }
    pub fn has_remaining_funds(&self) -> bool {
        self.withdrawn_amount < self.total_amount
    }
    pub fn is_final_withdrawal(&self, current_time: i64) -> Result<bool> {
        let earned = self.calculate_earned_amount(current_time)?;
        Ok(earned >= self.total_amount)
    }
    pub fn pause(&mut self, current_time: i64) -> Result<()> {
        if self.is_paused {
            return Err(error!(crate::errors::SprintVaultError::AlreadyPaused));
        }
        self.is_paused = true;
        self.pause_time = Some(current_time);
        Ok(())
    }
    pub fn resume(&mut self, current_time: i64) -> Result<()> {
        if !self.is_paused {
            return Err(error!(crate::errors::SprintVaultError::NotPaused));
        }
        if let Some(pause_time) = self.pause_time {
            let pause_duration = current_time
                .checked_sub(pause_time)
                .ok_or(error!(crate::errors::StreamVaultError::MathOverflow))?;
            self.total_paused_duration = self.total_paused_duration
                .checked_add(pause_duration)
                .ok_or(error!(crate::errors::StreamVaultError::MathOverflow))?;
        }
        self.is_paused = false;
        self.pause_time = None;
        Ok(())
    }
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq)]
pub enum StreamDuration {
    OneWeek,        
    TwoWeeks,       
    ThreeWeeks,     
    FourWeeks,      
    SixWeeks,       
    EightWeeks,     
    TenWeeks,       
    TwelveWeeks,    
}
impl StreamDuration {
    pub fn to_seconds(&self) -> i64 {
        const WEEK_IN_SECONDS: i64 = 7 * 24 * 60 * 60; 
        match self {
            StreamDuration::OneWeek => WEEK_IN_SECONDS,
            StreamDuration::TwoWeeks => 2 * WEEK_IN_SECONDS,
            StreamDuration::ThreeWeeks => 3 * WEEK_IN_SECONDS,
            StreamDuration::FourWeeks => 4 * WEEK_IN_SECONDS,
            StreamDuration::SixWeeks => 6 * WEEK_IN_SECONDS,
            StreamDuration::EightWeeks => 8 * WEEK_IN_SECONDS,
            StreamDuration::TenWeeks => 10 * WEEK_IN_SECONDS,
            StreamDuration::TwelveWeeks => 12 * WEEK_IN_SECONDS,
        }
    }
    pub fn description(&self) -> &'static str {
        match self {
            StreamDuration::OneWeek => "1 week",
            StreamDuration::TwoWeeks => "2 weeks",
            StreamDuration::ThreeWeeks => "3 weeks",
            StreamDuration::FourWeeks => "4 weeks (1 month)",
            StreamDuration::SixWeeks => "6 weeks",
            StreamDuration::EightWeeks => "8 weeks (2 months)",
            StreamDuration::TenWeeks => "10 weeks",
            StreamDuration::TwelveWeeks => "12 weeks (3 months)",
        }
    }
    pub fn to_days(&self) -> u32 {
        match self {
            StreamDuration::OneWeek => 7,
            StreamDuration::TwoWeeks => 14,
            StreamDuration::ThreeWeeks => 21,
            StreamDuration::FourWeeks => 28,
            StreamDuration::SixWeeks => 42,
            StreamDuration::EightWeeks => 56,
            StreamDuration::TenWeeks => 70,
            StreamDuration::TwelveWeeks => 84,
        }
    }
    pub fn from_seconds(seconds: i64) -> Option<Self> {
        const WEEK: i64 = 7 * 24 * 60 * 60;
        match seconds {
            s if s == 1 * WEEK => Some(StreamDuration::OneWeek),
            s if s == 2 * WEEK => Some(StreamDuration::TwoWeeks),
            s if s == 3 * WEEK => Some(StreamDuration::ThreeWeeks),
            s if s == 4 * WEEK => Some(StreamDuration::FourWeeks),
            s if s == 6 * WEEK => Some(StreamDuration::SixWeeks),
            s if s == 8 * WEEK => Some(StreamDuration::EightWeeks),
            s if s == 10 * WEEK => Some(StreamDuration::TenWeeks),
            s if s == 12 * WEEK => Some(StreamDuration::TwelveWeeks),
            _ => None,
        }
    }
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq)]
pub enum StreamStatus {
    Active,
    Paused,
    Completed,
    Cancelled,
}