use anchor_lang::prelude::*;
#[account]
pub struct EscrowVault {
    pub vault_id: u64,                      
    pub owner_program: Pubkey,              
    pub owner_account: Pubkey,              
    pub depositor: Pubkey,                  
    pub beneficiary: Pubkey,                
    pub arbiter: Option<Pubkey>,            
    pub token_mint: Pubkey,                 
    pub vault_token_account: Pubkey,        
    pub total_amount: u64,                  
    pub released_amount: u64,               
    pub refunded_amount: u64,               
    pub locked_amount: u64,                 
    pub release_schedule: ReleaseSchedule,  
    pub release_authority: ReleaseAuthority,
    pub status: EscrowStatus,               
    pub created_at: i64,                    
    pub updated_at: i64,                    
    pub expires_at: Option<i64>,            
    pub bump: u8,                           
}
impl EscrowVault {
    pub const LEN: usize = 8 + 
        8 +                     
        32 +                    
        32 +                    
        32 +                    
        32 +                    
        33 +                    
        32 +                    
        32 +                    
        8 +                     
        8 +                     
        8 +                     
        8 +                     
        200 +                   
        33 +                    
        2 +                     
        8 +                     
        8 +                     
        9 +                     
        1;                      
    pub fn validate_owner_program(&self, program_id: &Pubkey) -> Result<()> {
        require!(
            self.owner_program == *program_id,
            VaultError::UnauthorizedProgram
        );
        Ok(())
    }
    pub fn validate_status(&self, expected: EscrowStatus) -> Result<()> {
        require!(
            self.status == expected,
            VaultError::InvalidStatus
        );
        Ok(())
    }
    pub fn can_withdraw(&self, signer: &Pubkey) -> Result<bool> {
        match self.release_authority {
            ReleaseAuthority::Beneficiary => Ok(signer == &self.beneficiary),
            ReleaseAuthority::Depositor => Ok(signer == &self.depositor),
            ReleaseAuthority::Either => Ok(signer == &self.beneficiary || signer == &self.depositor),
            ReleaseAuthority::Both => Ok(false), 
            ReleaseAuthority::Program(ref authorized) => Ok(signer == authorized),
            ReleaseAuthority::Arbiter => {
                if let Some(ref arbiter) = self.arbiter {
                    Ok(signer == arbiter)
                } else {
                    Ok(false)
                }
            }
        }
    }
    pub fn calculate_available(&self, current_time: i64) -> Result<u64> {
        require!(
            self.status == EscrowStatus::Active || self.status == EscrowStatus::Funded,
            VaultError::InvalidStatus
        );
        if let Some(expires_at) = self.expires_at {
            require!(
                current_time <= expires_at,
                VaultError::VaultExpired
            );
        }
        let available = match &self.release_schedule {
            ReleaseSchedule::Immediate => self.total_amount,
            ReleaseSchedule::Linear { start, end } => {
                if current_time < *start {
                    0
                } else if current_time >= *end {
                    self.total_amount
                } else {
                    let elapsed = (current_time - start) as u128;
                    let duration = (end - start) as u128;
                    let amount = (self.total_amount as u128)
                        .checked_mul(elapsed)
                        .ok_or(VaultError::ArithmeticOverflow)?
                        .checked_div(duration)
                        .ok_or(VaultError::ArithmeticOverflow)?;
                    amount as u64
                }
            },
            ReleaseSchedule::Milestone { conditions } => {
                let mut total = 0u64;
                for condition in conditions {
                    if condition.is_completed {
                        total = total.checked_add(condition.amount)
                            .ok_or(VaultError::ArithmeticOverflow)?;
                    }
                }
                total
            },
            ReleaseSchedule::Hybrid { 
                linear_portion, 
                milestone_portion, 
                linear_config, 
                milestone_config 
            } => {
                let linear_available = if current_time < linear_config.start_time {
                    0
                } else if current_time >= linear_config.end_time {
                    *linear_portion
                } else {
                    let elapsed = (current_time - linear_config.start_time) as u128;
                    let duration = (linear_config.end_time - linear_config.start_time) as u128;
                    let base_amount = match linear_config.acceleration_type {
                        AccelerationType::Linear => {
                            (*linear_portion as u128)
                                .checked_mul(elapsed)
                                .ok_or(VaultError::ArithmeticOverflow)?
                                .checked_div(duration)
                                .ok_or(VaultError::ArithmeticOverflow)?
                        },
                        AccelerationType::Quadratic => {
                            let progress = elapsed
                                .checked_mul(10000)
                                .ok_or(VaultError::ArithmeticOverflow)?
                                .checked_div(duration)
                                .ok_or(VaultError::ArithmeticOverflow)?;
                            let progress_squared = progress
                                .checked_mul(progress)
                                .ok_or(VaultError::ArithmeticOverflow)?
                                .checked_div(10000)
                                .ok_or(VaultError::ArithmeticOverflow)?;
                            (*linear_portion as u128)
                                .checked_mul(progress_squared)
                                .ok_or(VaultError::ArithmeticOverflow)?
                                .checked_div(10000)
                                .ok_or(VaultError::ArithmeticOverflow)?
                        },
                        AccelerationType::Cubic => {
                            let progress = elapsed
                                .checked_mul(1000)
                                .ok_or(VaultError::ArithmeticOverflow)?
                                .checked_div(duration)
                                .ok_or(VaultError::ArithmeticOverflow)?;
                            let progress_cubed = progress
                                .checked_mul(progress)
                                .ok_or(VaultError::ArithmeticOverflow)?
                                .checked_div(1000)
                                .ok_or(VaultError::ArithmeticOverflow)?
                                .checked_mul(progress)
                                .ok_or(VaultError::ArithmeticOverflow)?
                                .checked_div(1000)
                                .ok_or(VaultError::ArithmeticOverflow)?;
                            (*linear_portion as u128)
                                .checked_mul(progress_cubed)
                                .ok_or(VaultError::ArithmeticOverflow)?
                                .checked_div(1000)
                                .ok_or(VaultError::ArithmeticOverflow)?
                        }
                    };
                    base_amount as u64
                };
                let mut milestone_available = 0u64;
                for condition in milestone_config {
                    if condition.is_completed {
                        milestone_available = milestone_available
                            .checked_add(condition.amount)
                            .ok_or(VaultError::ArithmeticOverflow)?;
                    }
                }
                linear_available.checked_add(milestone_available)
                    .ok_or(VaultError::ArithmeticOverflow)?
            },
            ReleaseSchedule::Custom { .. } => {
                return Err(VaultError::UnsupportedSchedule.into());
            }
        };
        let withdrawable = available.saturating_sub(self.released_amount);
        let effective_total = self.total_amount.saturating_sub(self.locked_amount);
        Ok(withdrawable.min(effective_total.saturating_sub(self.released_amount)))
    }
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub enum ReleaseSchedule {
    Immediate,                              
    Linear { 
        start: i64, 
        end: i64 
    },                                      
    Milestone { 
        conditions: Vec<MilestoneCondition> 
    },                                      
    Hybrid {
        linear_portion: u64,                
        milestone_portion: u64,              
        linear_config: LinearConfig,
        milestone_config: Vec<MilestoneCondition>,
    },                                      
    Custom { 
        data: Vec<u8> 
    },                                      
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct MilestoneCondition {
    pub milestone_id: u32,
    pub amount: u64,
    pub required_approval: Pubkey,
    pub is_completed: bool,
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct LinearConfig {
    pub start_time: i64,
    pub end_time: i64,
    pub acceleration_type: AccelerationType,
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub enum AccelerationType {
    Linear,
    Quadratic,
    Cubic,
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub enum ReleaseAuthority {
    Beneficiary,                            
    Depositor,                              
    Either,                                 
    Both,                                   
    Program(Pubkey),                        
    Arbiter,                                
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq)]
pub enum EscrowStatus {
    Initialized,                            
    Funded,                                 
    Active,                                 
    Paused,                                 
    Completed,                              
    Cancelled,                              
    Disputed,                               
}
#[account]
pub struct EscrowConfig {
    pub authority: Pubkey,                  
    pub fee_basis_points: u16,              
    pub fee_recipient: Pubkey,              
    pub min_escrow_amount: u64,             
    pub max_escrow_duration: i64,           
    pub paused: bool,                       
    pub version: u32,                       
    pub bump: u8,
}
impl EscrowConfig {
    pub const LEN: usize = 8 + 
        32 +                    
        2 +                     
        32 +                    
        8 +                     
        8 +                     
        1 +                     
        4 +                     
        1;                      
    pub fn is_compatible(&self, required_version: u32) -> Result<()> {
        require!(
            self.version >= required_version,
            VaultError::IncompatibleVersion
        );
        Ok(())
    }
}
#[error_code]
pub enum VaultError {
    #[msg("Unauthorized program attempting to access vault")]
    UnauthorizedProgram,
    #[msg("Invalid vault status for this operation")]
    InvalidStatus,
    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,
    #[msg("Vault has expired")]
    VaultExpired,
    #[msg("Unsupported release schedule")]
    UnsupportedSchedule,
    #[msg("Incompatible version")]
    IncompatibleVersion,
    #[msg("Insufficient funds in vault")]
    InsufficientFunds,
    #[msg("Unauthorized access")]
    Unauthorized,
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Invalid time range")]
    InvalidTimeRange,
    #[msg("Vault already funded")]
    AlreadyFunded,
    #[msg("Vault not funded")]
    NotFunded,
    #[msg("Program is paused")]
    ProgramPaused,
    #[msg("Milestone not found")]
    MilestoneNotFound,
    #[msg("Milestone already completed")]
    MilestoneAlreadyCompleted,
    #[msg("Invalid milestone configuration")]
    InvalidMilestoneConfig,
}