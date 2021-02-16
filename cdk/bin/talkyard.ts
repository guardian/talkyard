#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "@aws-cdk/core";
import { TalkyardStack } from "../lib/talkyard-stack";

const app = new cdk.App();
new TalkyardStack(app, "TalkyardStack", { app: "talkyard" });
