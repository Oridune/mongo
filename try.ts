import e from "./validator.ts";
import { ObjectId } from "./deps.ts";
import { Mongo } from "./mod.ts";

const Cache = new Map<
  string,
  {
    value: any;
    ttl: number;
    time: number;
  }
>();

try {
  Mongo.post("connect", () => Mongo.drop());

  // Create Post Schema
  const PostSchema = e.object({
    title: e.string(),
    description: e.string(),
    drafted: e.optional(e.boolean()).default(true),
    createdAt: e.optional(e.date()).default(() => new Date()),
    updatedAt: e.optional(e.date()).default(() => new Date()),
  });

  const PostModel = Mongo.model("post", PostSchema);

  const FileSchema = e.object({
    name: e.optional(e.string()),
    url: e.string(),
    mimeType: e.optional(e.string()),
    sizeInBytes: e.optional(e.number({ cast: true })),
    alt: e.optional(e.string()),
  });

  // Create User Schema
  const UserSchema = e.object({
    _id: e
      .optional(e.if(ObjectId.isValid))
      .custom((ctx) => new ObjectId(ctx.output)),
    username: e.string(),
    password: e.optional(e.string()).default("topSecret"),
    avatar: e.optional(FileSchema),
    profile: e.optional(
      e.object({
        name: e.string(),
        dob: e.optional(e.date()),
      })
    ),
    followers: e.optional(e.array(e.if(ObjectId.isValid))),
    posts: e.optional(e.array(e.if(ObjectId.isValid))),
    latestPost: e.optional(e.if(ObjectId.isValid)),
    attachments: e.optional(e.array(FileSchema)),
    activity: e.optional(
      e.array(
        e.object({
          description: e.string(),
          user: e.instanceOf(ObjectId, { instantiate: true }),
        })
      )
    ),
    latestActivity: e.optional(
      e.object({
        description: e.string(),
        user: e.instanceOf(ObjectId, { instantiate: true }),
      })
    ),
    createdAt: e.optional(e.date()).default(() => new Date()),
    updatedAt: e.optional(e.date()).default(() => new Date()),
  });

  // Create User Model
  const UserModel = Mongo.model("user", UserSchema);

  UserModel.createIndex(
    {
      key: { username: 1 },
      unique: true,
      background: true,
      partialFilterExpression: { username: { $exists: true } },
    },
    {
      key: { username: "text", "profile.name": "text" },
      // background: true,
    }
  );

  UserModel
    // .pre("create", (details) => {
    //   const Doc = details.data;
    //   console.log(Doc);
    //   return Doc;
    // })
    //   .post("create", (details) => {
    //     const Doc = details.data;
    //     console.log(Doc);
    //     return Doc;
    //   })
    //   .post("read", (details) => {
    //     const Doc = details.data;
    //     console.log(Doc);
    //     return Doc;
    //   })
    .pre("update", (details) => {
      details.updates.$set = {
        ...details.updates.$set,
        updatedAt: new Date(),
      };
    });

  Mongo.enableLogs = true;

  await Mongo.connect("mongodb://localhost:27017/mongo");

  Mongo.setCachingMethods(
    (key, value, ttl) => {
      Cache.set(key, { value, ttl, time: Date.now() / 1000 });
    },
    (key) => {
      const Value = Cache.get(key);
      if (Value && Value.ttl + Value.time >= Date.now() / 1000)
        return Value.value;
    },
    (key) => {
      Cache.delete(key);
    }
  );

  // (async () => {
  //   for await (const _ of UserModel.watch({}, { fullDocument: "updateLookup" }))
  //     console.log("Change Detected!", _);
  // })();

  const User1Id = new ObjectId();
  const User2Id = new ObjectId();

  await Mongo.transaction(async (session) => {
    const Post = await PostModel.create(
      {
        title: "Test",
        description: "This is a test post.",
      },
      { session }
    );

    await UserModel.createMany(
      [
        {
          _id: User1Id,
          username: "saffellikhan",
          // password: "secret2",
          profile: {
            name: "Saif Ali Khan",
            // dob: new Date(),
          },
          posts: [Post._id],
          latestPost: Post._id,
          followers: [User2Id],
          activity: [
            {
              description: "Logged in!",
              user: User1Id,
            },
            {
              description: "Waved by someone!",
              user: User2Id,
            },
          ],
          latestActivity: {
            description: "Waved by someone!",
            user: User2Id,
          },
        },
        {
          _id: User2Id,
          username: "abdullah",
          password: "secret3",
          profile: {
            name: "Abdullah Khan",
            dob: new Date(),
          },
          followers: [User1Id],
        },
      ],
      { session }
    );

    // await UserModel.findOne({}, { session })
    //   .populate("posts", PostModel)
    //   .populateOne("latestPost", PostModel);

    // console.log(
    //   await UserModel.updateMany(
    //     { username: "saffellikhan" },
    //     {
    //       "profile.dob": new Date(),
    //     },
    //     { session }
    //   )
    // );

    // console.log(
    //   await UserModel.replaceOne(
    //     { username: "saffellikhan" },
    //     { username: "john", profile: { name: "John Doe", dob: new Date() } }
    //   )
    // );

    // console.time("fetch");

    // await UserModel.find({}, { cache: { key: "myFetch", ttl: 3000 } });

    // console.timeEnd("fetch");

    // console.time("fetch");

    // await UserModel.find({}, { cache: { key: "myFetch", ttl: 3000 } });

    // console.timeEnd("fetch");

    // console.time("fetch");

    // const User = await UserModel.find(
    //   {},
    //   { cache: { key: "myFetch", ttl: 3000 } }
    // ).populate(
    //   "followers",
    //   UserModel.populate(
    //     "followers",
    //     UserModel.populateOne("latestPost", PostModel, { sort: { _id: -1 } })
    //   )
    // );

    // console.log(User[0].followers[0].followers[0].latestPost);

    // console.timeEnd("fetch");

    // console.log(
    // await UserModel.findOne(
    //   {},
    //   {
    //     cache: {
    //       key: `users`,
    //       ttl: 60, // Cache for 5 minutes...
    //     },
    //     session,
    //   }
    // ).populateOne(
    //   "activity.user",
    //   UserModel.populateOne("latestPost", PostModel)
    // );
    //   // .search("Khan", { session })
    //   // .filter({
    //   //   username: "saffellikhan",
    //   // })
    //   // .populate("posts", PostModel)
    //   // .populateOne("latestActivity.user", UserModel)
    // );
  });

  await Mongo.disconnect();

  console.log("Connected:", Mongo.isConnected());

  await Mongo.connect("mongodb://localhost:27017/mongo");

  console.log("Connected:", Mongo.isConnected());

  await UserModel.updateMany(
    {},
    {
      password: "revealed!",
      $push: {
        attachments: {
          $each: [{ url: null, sizeInBytes: 1 }],
          $position: 2,
        },
        followers: User1Id,
      },
      $setOnInsert: {
        avatar: { url: null },
      },
    }
  );
} catch (error) {
  console.log(error);
}

Mongo.disconnect();
