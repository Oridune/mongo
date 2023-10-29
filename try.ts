import { ObjectId } from "mongodb";
import { Mongo } from "./mod.ts";
import e from "validator";

const Cache = new Map<
  string,
  {
    value: any;
    ttl: number;
    time: number;
  }
>();

try {
  Mongo.enableLogs = true;

  await Mongo.connect("mongodb://localhost:27017/mongo");
  await Mongo.drop();

  Mongo.setCachingMethods(
    (key, value, ttl) => {
      Cache.set(key, { value, ttl, time: Date.now() / 1000 });
    },
    (key) => {
      const Value = Cache.get(key);
      if (Value && Value.ttl + Value.time >= Date.now() / 1000)
        return Value.value;
    }
  );

  // Create Post Schema
  const PostSchema = e.object({
    title: e.string(),
    description: e.string(),
    drafted: e.optional(e.boolean()).default(true),
    createdAt: e.optional(e.date()).default(() => new Date()),
    updatedAt: e.optional(e.date()).default(() => new Date()),
  });

  const PostModel = Mongo.model("post", PostSchema);

  // Create User Schema
  const UserSchema = e.object({
    username: e.string(),
    password: e.optional(e.string()).default("topSecret"),
    profile: e.object({
      name: e.string(),
      dob: e.date(),
    }),
    followers: e.optional(e.array(e.if(ObjectId.isValid))),
    posts: e.optional(e.array(e.if(ObjectId.isValid))),
    latestPost: e.optional(e.if(ObjectId.isValid)),
    createdAt: e.optional(e.date()).default(() => new Date()),
    updatedAt: e.optional(e.date()).default(() => new Date()),
  });

  // Create User Model
  const UserModel = Mongo.model("user", UserSchema);

  await UserModel.createIndex(
    {
      key: { username: 1 },
      unique: true,
      background: true,
      partialFilterExpression: { username: { $exists: true } },
    },
    {
      key: { username: "text", "profile.name": "text" },
      background: true,
    }
  );

  UserModel.pre("create", (details) => {
    const Doc = details.data;
    console.log(Doc);
    return Doc;
  })
    .post("create", (details) => {
      const Doc = details.data;
      console.log(Doc);
      return Doc;
    })
    .post("read", (details) => {
      const Doc = details.data;
      console.log(Doc);
      return Doc;
    })
    .pre("update", (details) => {
      details.updates.$set = {
        ...details.updates.$set,
        updatedAt: new Date(),
      };
    });

  // (async () => {
  //   for await (const _ of UserModel.watch({}, { fullDocument: "updateLookup" }))
  //     console.log("Change Detected!", _);
  // })();

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
          username: "saffellikhan",
          // password: "secret2",
          profile: {
            name: "Saif Ali Khan",
            dob: new Date(),
          },
          posts: [Post._id],
          latestPost: Post._id,
        },
        {
          username: "abdullah",
          password: "secret3",
          profile: {
            name: "Abdullah Khan",
            dob: new Date(),
          },
        },
      ],
      { session }
    );

    await UserModel.findOne({}, { session })
      .populate("posts", PostModel)
      .populateOne("latestPost", PostModel);

    console.log(
      await UserModel.updateMany(
        { username: "saffellikhan" },
        {
          "profile.dob": new Date(),
        },
        { session }
      )
    );

    console.log(
      await UserModel.replaceOne(
        { username: "saffellikhan" },
        { username: "john", profile: { name: "John Doe", dob: new Date() } }
      )
    );

    console.time("fetch");

    await UserModel.find({}, { cache: { key: "myFetch", ttl: 3000 } });

    console.timeEnd("fetch");

    console.time("fetch");

    await UserModel.find({}, { cache: { key: "myFetch", ttl: 3000 } });

    console.timeEnd("fetch");

    console.time("fetch");

    await UserModel.find({}, { cache: { key: "myFetch", ttl: 3000 } });

    console.timeEnd("fetch");
  });
} catch (error) {
  console.log(error);
}

Mongo.disconnect();
