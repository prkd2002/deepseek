import { Webhook } from "svix";
import connectDB from "@/config/db"; // Assuming this connects to your database
import User from "@/model/user"; // Assuming this is your Mongoose User model
import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

// Define the structure of the data payload from Clerk webhook
interface ClerkWebhookData {
  id: string;
  email_addresses: Array<{ email_address: string }>;
  first_name: string | null;
  last_name: string | null;
  image_url: string;
  // Add other properties if they are part of the webhook payload you expect
}

// Define the structure of the verified webhook payload
interface VerifiedWebhookPayload {
  data: ClerkWebhookData;
  type: 'user.created' | 'user.updated' | 'user.deleted';
}

// Define the structure of the user data to be saved in the database
interface UserData {
  _id: string;
  email: string;
  name: string;
  image: string;
}

export async function POST(req: NextRequest) {
  // Ensure SIGNING_SECRET is defined in your environment variables
  const WEBHOOK_SECRET = process.env.SIGNING_SECRET;

  if (!WEBHOOK_SECRET) {
    console.error("SIGNING_SECRET is not set in environment variables.");
    return NextResponse.json({ message: "Webhook secret not configured" }, { status: 500 });
  }

  const wh = new Webhook(WEBHOOK_SECRET);

  // Fix: headers() returns the object directly, no need for await
  const headerPayLoad = headers();
  const svixHeaders = {
    "svix-id":   (await headerPayLoad).get("svix-id") || "",
    "svix-timestamp": (await headerPayLoad).get("svix-timestamp") || "",
    "svix-signature": (await headerPayLoad).get("svix-signature") || "",
  };

  // Validate required headers
  if (!svixHeaders["svix-id"] || !svixHeaders["svix-timestamp"] || !svixHeaders["svix-signature"]) {
    console.error("Missing required Svix headers");
    return NextResponse.json({ message: "Missing required headers" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let payload: any;
  try {
    payload = await req.json();
  } catch (err) {
    console.error("Error parsing request body:", err);
    return NextResponse.json({ message: "Invalid request body" }, { status: 400 });
  }

  const body = JSON.stringify(payload);

  let verifiedPayload: VerifiedWebhookPayload;
  try {
    // Verify the payload
    verifiedPayload = wh.verify(body, svixHeaders) as VerifiedWebhookPayload;
  } catch (err) {
    console.error("Error verifying webhook:", err);
    return NextResponse.json({ message: "Webhook verification failed" }, { status: 400 });
  }

  const { data, type } = verifiedPayload;

  // Validate required data
  if (!data.id) {
    console.error("User ID is missing from webhook data");
    return NextResponse.json({ message: "User ID is required" }, { status: 400 });
  }

  // Prepare the user data to be saved in the database
  const userEmail = data.email_addresses && data.email_addresses.length > 0
    ? data.email_addresses[0].email_address
    : '';

  // Validate email for user.created events
  if (type === 'user.created' && !userEmail) {
    console.error("No email address found in webhook data for user creation");
    return NextResponse.json({ message: "Email is required for user creation" }, { status: 400 });
  }

  const userName = `${data.first_name || ''} ${data.last_name || ''}`.trim();

  const userData: UserData = {
    _id: data.id,
    email: userEmail,
    name: userName,
    image: data.image_url,
  };

  try {
    await connectDB(); // Connect to your database

    switch (type) {
      case 'user.created':
        console.log("User created event:", userData);
        try {
          await User.create(userData);
          console.log(`User ${data.id} created successfully`);
        } catch (createError) {
          console.error("Error creating user:", createError);
          // Check if it's a duplicate key error
          if (createError instanceof Error && createError.message.includes('duplicate key')) {
            console.warn(`User ${data.id} already exists, skipping creation`);
          } else {
            throw createError;
          }
        }
        break;

      case 'user.updated':
        console.log("User updated event for ID:", data.id, userData);
        const updatedUser = await User.findByIdAndUpdate(data.id, userData, { new: true });
        if (!updatedUser) {
          console.warn(`User with ID ${data.id} not found for update`);
          // Optionally create the user if it doesn't exist
          await User.create(userData);
          console.log(`User ${data.id} created during update event`);
        } else {
          console.log(`User ${data.id} updated successfully`);
        }
        break;

      case 'user.deleted':
        console.log("User deleted event for ID:", data.id);
        const deletedUser = await User.findByIdAndDelete(data.id);
        if (!deletedUser) {
          console.warn(`User with ID ${data.id} not found for deletion`);
        } else {
          console.log(`User ${data.id} deleted successfully`);
        }
        break;

      default:
        console.warn(`Unhandled webhook event type: ${type}`);
        return NextResponse.json({ message: `Unhandled event type: ${type}` }, { status: 400 });
    }

    return NextResponse.json({ message: "Event processed successfully" }, { status: 200 });

  } catch (dbError) {
    console.error("Database operation failed:", dbError);
    return NextResponse.json({ message: "Internal server error during database operation" }, { status: 500 });
  }
}