// MongoDB permission fix script
// Run this on your MongoDB server to grant write access to the xow database

// Connect to admin database
use admin;

// Find your current user (replace 'your_username' with actual username from MONGO_URL)
db.getUsers();

// Grant readWrite role to your user on the 'xow' database
// Replace 'your_username' with the actual username from your connection string
db.grantRolesToUser(
  "xow-user",  // User name
  [
    { role: "readWrite", db: "xow" }
  ]
);

// Verify the user now has readWrite permissions
db.getUser("xow-user");  // User name

print("✅ Permissions updated. User should now have readWrite access to 'xow' database.");
