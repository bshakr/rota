# `not_change`, the readable negation of RSpec's `change` matcher.
#
# It lives here rather than at the top of whichever spec file happened to need it first, because a
# matcher defined inside one file is defined for the whole run once that file loads — so a spec
# using it passed or failed depending on whether its neighbour was in the same run. spec/support is
# loaded by rails_helper before any example, which is the only place a global matcher can honestly
# live.
RSpec::Matchers.define_negated_matcher :not_change, :change
