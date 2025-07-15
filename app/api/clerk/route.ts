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
  type: 'user.created' | 'user.updated' | 'user.deleted' | string; // 'string' for any other unhandled types
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

  const headerPayLoad = headers();
  const svixHeaders = {
    "svix-id": (await headerPayLoad).get("svix-id") || "", // Provide a default empty string if null
    "svix-timestamp": (await headerPayLoad).get("svix-timestamp") || "", // Svix also sends a timestamp
    "svix-signature": (await headerPayLoad).get("svix-signature") || "", // Provide a default empty string if null
  };

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
    // The 'as VerifiedWebhookPayload' asserts the type after successful verification
    verifiedPayload = wh.verify(body, svixHeaders) as VerifiedWebhookPayload;
  } catch (err) {
    console.error("Error verifying webhook:", err);
    return NextResponse.json({ message: "Webhook verification failed" }, { status: 400 });
  }

  const { data, type } = verifiedPayload;

  // Prepare the user data to be saved in the database
  // Ensure email_addresses array and its first element exist
  const userEmail = data.email_addresses && data.email_addresses.length > 0
    ? data.email_addresses[0].email_address
    : ''; // Provide a default empty string or handle as error if email is mandatory

  const userName = `${data.first_name || ''} ${data.last_name || ''}`.trim(); // Handle null first/last names

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
        await User.create(userData);
        break;
      case 'user.updated':
        console.log("User updated event for ID:", data.id, userData);
        await User.findByIdAndUpdate(data.id, userData);
        break;
      case 'user.deleted':
        console.log("User deleted event for ID:", data.id);
        await User.findByIdAndDelete(data.id);
        break;
      default:
        console.warn(`Unhandled webhook event type: ${type}`);
        break;
    }

    return NextResponse.json({ message: "Event received" }, { status: 200 });

  } catch (dbError) {
    console.error("Database operation failed:", dbError);
    return NextResponse.json({ message: "Internal server error during database operation" }, { status: 500 });
  }
}
