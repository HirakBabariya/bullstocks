import { ApolloServer } from "@apollo/server";
import { expressMiddleware } from "@apollo/server/express4";
import { json } from "body-parser";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import mongoose from "mongoose";
import { Server } from "socket.io";
import schema from "./graphql/schema";
import { stopUpdatingStockPrices, updateStockPrices } from "./socket/market";
import stripePaymentHandler from "./routes/stripePaymentWebhook";
import stripePlatformDepositHTest from "./routes/stripePlatformDepositRoutes";

dotenv.config();
const app = express();

// Stripe webhook for payment deposit
app.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  stripePaymentHandler
);

// Middleware setup for handling JSON and URL-encoded data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: true, credentials: true }));

//Test loading funds: curl -X POST http://localhost:4000/api/test/add-funds
app.use("/api/test", stripePlatformDepositHTest);

// Error Handling Middleware
app.use(
  (
    err: any,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    console.error("Error:", err.message || err);
    res
      .status(err.status || 500)
      .json({
        success: false,
        message: err.message || "Internal Server Error",
      });
  }
);

// Define the context interface for Apollo Server
interface MyContext {
  token?: string;
}

// Initialize the Apollo Server with the GraphQL schema and context
const server = new ApolloServer<MyContext>({ schema });

const init = async () => {
  // Start the Apollo Server
  await server.start();

  // Set up GraphQL endpoint with Express middleware
  // app.use(
  //   "/graphql",
  //   cors({ origin: true, credentials: true }),
  //   json(),
  //   expressMiddleware(server, {
  //     context: async ({ req }) => ({ token: req.headers.authorization }),
  //   })
  // );

  app.use(
    '/graphql',
    expressMiddleware(server, {
      context: async ({ req }) => {
        const token = req.headers.authorization || '';
        //console.log('Authorization header from client:', token); // Debug log
        return { token };
      },
    })
  );

  // MongoDB connection URI using environment variables
  // const uri = `mongodb+srv://${process.env.MONGO_USER}:${process.env.MONGO_PASSWORD}@hirakbabariya.pruqh.mongodb.net/${process.env.MONGO_DB}?retryWrites=true&w=majority`;
  const uri = `mongodb+srv://${process.env.MONGO_USER}:${process.env.MONGO_PASSWORD}@cluster0.gjhevbl.mongodb.net/${process.env.MONGO_DB}?retryWrites=true&w=majority`;

  // Connect to MongoDB
  mongoose
    .connect(uri)
    .then(() => {
      console.log("MongoDB connection established successfully");
    })
    .catch((error) => {
      console.error("Error connecting to MongoDB:", error);
      throw error;
    });

  // Start the HTTP server
  const httpServer = app.listen(process.env.PORT, () => {
    console.log(
      `Server is running at http://localhost:${process.env.PORT}/graphql`
    );
  });

  // Set up WebSocket server for real-time communication
  const io = new Server(httpServer, {
    path: "/socket.io"
  });

  io.on("connection", (socket) => {
    console.log("New client connected:", socket?.id);
    updateStockPrices(5000, io);

    socket.on("disconnect", () => {
      if (io.engine.clientsCount === 0) {
        stopUpdatingStockPrices();
        console.log("No users connected, stopped stock updates");
      }
    });
  });
};

// Initialize the server setup
init();
