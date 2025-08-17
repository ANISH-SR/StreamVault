use anchor_lang::prelude::*;
#[error_code]
pub enum StreamVaultError {
    #[msg("Insufficient funds in escrow")]
    InsufficientFunds,
    #[msg("Stream has expired")]
    StreamExpired,
    #[msg("Stream has not started yet")]
    StreamNotStarted,
    #[msg("Unauthorized access")]
    Unauthorized,
    #[msg("Stream is currently paused")]
    StreamPaused,
    #[msg("Stream is already paused")]
    AlreadyPaused,
    #[msg("Stream is not paused")]
    NotPaused,
    #[msg("Invalid time range")]
    InvalidTimeRange,
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Stream already exists")]
    StreamAlreadyExists,
    #[msg("No funds available for withdrawal")]
    NoFundsAvailable,
    #[msg("Invalid mint")]
    InvalidMint,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Stream not ended")]
    StreamNotEnded,
    #[msg("Stream has remaining funds")]
    RemainingFunds,
    #[msg("Invalid stream status")]
    InvalidStreamStatus,
    #[msg("Stream not fully funded")]
    StreamNotFunded,
    #[msg("Stream already started")]
    StreamAlreadyStarted,
    #[msg("Stream is already fully funded")]
    StreamAlreadyFunded,
    #[msg("Unsupported token mint")]
    UnsupportedMint,
    #[msg("Amount below minimum withdrawal threshold")]
    BelowMinimumWithdrawal,
    #[msg("Only employer can pause/resume sprint")]
    OnlyEmployerCanPauseResume,
    #[msg("Maximum pause/resume count exceeded")]
    MaxPauseResumeExceeded,
    #[msg("Stream auto-closed due to excessive pause duration")]
    StreamAutoClosedDueToExcessivePause,
    #[msg("Token account is frozen")]
    FrozenTokenAccount,
    #[msg("Invalid token decimals")]
    InvalidTokenDecimals,
    #[msg("Invalid mint for current network")]
    InvalidNetworkMint,
    #[msg("Operation would leave dust amount")]
    DustAmount,
    #[msg("Concurrent operation detected")]
    ConcurrentOperation,
    #[msg("Invalid timestamp - possible clock drift")]
    InvalidTimestamp,
    #[msg("PDA collision detected")]
    PDACollision,
    #[msg("Insufficient token balance")]
    InsufficientTokenBalance,
    #[msg("Invalid stream duration - must be one of the predefined durations")]
    InvalidStreamDuration,
}