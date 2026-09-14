# Rack::Attack's counters are a per-process MemoryStore (see config/initializers/rack_attack.rb), so
# without this every request the suite makes would keep counting into the next example's window: one
# file that hammers /api/member/* with bad tokens would leave the enumeration bucket nearly full and
# the next file's first request would be refused for reasons that have nothing to do with it.
#
# Emptying the buckets before each example gives every one of them the same starting state, while
# still running the real throttle over the real store. The store used to be the test environment's
# null cache, which silently meant no spec could ever observe a limit, so the three specs that are
# ABOUT a limit each swapped in a store of their own inside an `around`. None of them needs to any
# more: this is the real store, and it starts every example empty.
RSpec.configure do |config|
  config.before { Rack::Attack.reset! }
end
