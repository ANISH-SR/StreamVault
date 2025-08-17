# Streaming Strategies

## Overview

The Sprint Vault program uses the **Strategy Pattern** to calculate streaming payment amounts. This design allows for flexible payment distribution models while maintaining clean separation of concerns.

## Architecture

### Core Components

1. **`StreamingStrategy` Trait** (`streaming_strategy.rs`)
   - Defines the interface that all streaming strategies must implement
   - Key methods:
     - `calculate_earned_amount()`: Computes total earned up to a point in time
     - `calculate_release_rate()`: Determines tokens per second release rate
     - `description()`: Provides human-readable strategy description

2. **`StreamingContext`** (`streaming_strategy.rs`)
   - Encapsulates all parameters needed for streaming calculations
   - Provides helper methods for time calculations with pause handling

3. **`LinearStreamingStrategy`** (`linear_streaming.rs`)
   - Default implementation using linear interpolation
   - Formula: `earned = (total_amount × elapsed_time) ÷ total_duration`
   - Handles pauses by adjusting elapsed time calculations

4. **`ExponentialStreamingStrategy`** (`exponential_streaming.rs`)
   - Accelerated payment distribution using exponential curves
   - Formula: `earned = total_amount × (elapsed_time / total_duration)^acceleration_factor`
   - Configurable acceleration factor (1.0 = linear, 2.0 = quadratic, 3.0 = cubic)
   - Useful for incentivizing late-stage completion or back-loading payments

## Linear Interpolation Formula

The linear streaming strategy implements time-based proportional payment distribution:

```rust
// Core formula
earned_amount = (total_amount × elapsed_time) / total_duration

// Where:
// - elapsed_time = current_time - start_time - total_paused_duration
// - total_duration = end_time - start_time
```

### Key Features

- **Pause Handling**: Automatically adjusts for paused periods
- **Overflow Protection**: Uses u128 arithmetic for intermediate calculations
- **Boundary Conditions**: Properly handles edge cases (not started, completed, zero duration)

## Exponential Interpolation Formula

The exponential streaming strategy implements accelerated payment distribution:

```rust
// Core formula
earned_amount = total_amount × (elapsed_time / total_duration)^acceleration_factor

// Where:
// - acceleration_factor controls the curve steepness
// - 1.0 = linear distribution
// - 2.0 = quadratic acceleration (slower early, faster late)
// - 3.0 = cubic acceleration (very slow early, very fast late)
```

## Strategy Comparison

### Linear vs Exponential (factor=2.0) Payment Distribution

| Time Progress | Linear Strategy | Exponential (2.0) | Difference |
|--------------|----------------|-------------------|------------|
| 25%          | 25% paid       | 6.25% paid        | -18.75%    |
| 50%          | 50% paid       | 25% paid          | -25%       |
| 75%          | 75% paid       | 56.25% paid       | -18.75%    |
| 100%         | 100% paid      | 100% paid         | 0%         |

### Use Cases

**Linear Strategy:**
- Fair and predictable payment distribution
- Best for standard freelance work
- Equal value delivered throughout the sprint

**Exponential Strategy:**
- Incentivizes completion and delivery
- Back-loads payment for milestone-based work
- Protects employers early in the project
- Rewards freelancers for finishing strong

## Usage Example

```rust
// In Sprint struct
pub fn calculate_earned_amount(&self, current_time: i64) -> Result<u64> {
    let strategy = LinearStreamingStrategy::new();
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
```

## Adding New Strategies

To implement a new streaming strategy:

1. Create a new file in the `strategies` directory
2. Implement the `StreamingStrategy` trait
3. Add your module to `mod.rs`

Example for an exponential strategy:

```rust
pub struct ExponentialStreamingStrategy {
    acceleration_factor: f64,
}

impl StreamingStrategy for ExponentialStreamingStrategy {
    fn calculate_earned_amount(...) -> Result<u64> {
        // Implement exponential growth formula
    }
    // ... other trait methods
}
```

## Benefits of Strategy Pattern

1. **Extensibility**: Easy to add new payment distribution models
2. **Testability**: Each strategy can be tested in isolation
3. **Maintainability**: Changes to calculation logic don't affect core program
4. **Flexibility**: Different sprints could use different strategies (future enhancement)

## Testing

Each strategy includes unit tests to verify correct behavior:

```bash
cargo test --lib -- strategies
```

Tests cover:
- Basic linear interpolation
- Pause handling
- Edge cases (boundaries, overflow)
- Time calculation accuracy
