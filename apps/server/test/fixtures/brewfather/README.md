# Brewfather v2 fixtures

The iSpindel reading is the recorded response in [Brewfather's API documentation](https://docs.brewfather.app/api#get-batch-last-reading),
wrapped as an item in the all-readings array. The recipe, batch, inventory and second reading
use representative fixture data based on the [published response types](https://docs.brewfather.app/api/types).
All tests use local responses through an injected fetch function.
