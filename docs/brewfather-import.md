# Import from Brewfather

Create a Brewfather API key with the `recipes.read`, `batches.read`, and `inventory.read`
scopes. Use its user ID and key in the JSON body of
`POST /api/integrations/brewfather/preview`. Brew-Bruvs uses the key for that fetch and
discards it. The response contains private recipe drafts, batches and on-hand stock.

Review the drafts and keep each batch's recipe reference in the selection. A batch has its own
draft when its Brewfather recipe differs from the current library recipe. Ingredient names with
no unambiguous catalog match stay as free text. Outside source credit is saved with the recipe
when Brewfather includes it.

Send the reviewed response shape to `POST /api/integrations/brewfather/import` to save the
selected records in one transaction. The confirmation accepts only import data. Each save adds
new records to the signed-in account. Imported batch readings and statuses are historical.
They do not reserve or deduct the on-hand stock imported alongside them.

A preview is limited to 250 library recipes, 250 batches, 20,000 readings per batch, and
250 inventory rows in each ingredient category. Imports above the size limit return an error
before saving any data. See the [Brewfather API documentation](https://docs.brewfather.app/api)
for API key setup.
